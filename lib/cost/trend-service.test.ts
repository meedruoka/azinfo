import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { server } from '@/tests/msw-server';
import { createTrendService } from './trend-service';

const SUB = '00000000-0000-0000-0000-000000000003';
const ARM = 'https://management.azure.com';
const SUB_QUERY = `${ARM}/subscriptions/${SUB}/providers/Microsoft.CostManagement/query`;
const RG_QUERY = `${ARM}/subscriptions/${SUB}/resourceGroups/rg-web/providers/Microsoft.CostManagement/query`;
const RG_BUDGETS = `${ARM}/subscriptions/${SUB}/resourceGroups/rg-web/providers/Microsoft.Consumption/budgets`;
const RESOURCE = `/subscriptions/${SUB}/resourceGroups/rg-web/providers/Microsoft.Web/sites/App`;
const NOW = Date.UTC(2026, 10, 4, 12);
const HOUR = 3_600_000;

const DAILY = {
  properties: {
    nextLink: null,
    columns: [
      { name: 'Cost', type: 'Number' },
      { name: 'UsageDate', type: 'Number' },
      { name: 'Currency', type: 'String' },
    ],
    rows: [
      [1, 20261001, 'EUR'],
      [2, 20261101, 'EUR'],
    ],
  },
};

describe('trend service', () => {
  let now = NOW;
  let bodies: { url: string; body: Record<string, unknown> }[] = [];

  const service = () =>
    createTrendService({
      getAccessToken: async () => 'AT',
      ttlMs: () => 4 * HOUR,
      costType: () => 'ActualCost',
      now: () => now,
      sleep: async () => {},
    });

  function answer(url: string, handler: (body: Record<string, unknown>) => Response) {
    server.use(
      http.post(url, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push({ url: request.url, body });
        return handler(body);
      }),
    );
  }

  beforeEach(() => {
    fakeBrowser.reset();
    now = NOW;
    bodies = [];
  });

  it('asks for one resource at subscription scope, then serves from the cache', async () => {
    answer(SUB_QUERY, () => HttpResponse.json(DAILY));
    const trends = service();
    const target = { kind: 'resource', subscriptionId: SUB, resourceId: RESOURCE } as const;
    const first = await trends.getTrend(target);
    await trends.getTrend(target);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body).toMatchObject({
      dataset: {
        granularity: 'Daily',
        filter: { dimensions: { values: [RESOURCE.toLowerCase()] } },
      },
    });
    expect(first.daily.days).toEqual({ '2026-10-01': 1, '2026-11-01': 2 });
    expect(first.budget).toBeNull();
  });

  it('runs a group at its own scope and picks the lowest whole-group monthly budget', async () => {
    answer(RG_QUERY, () => HttpResponse.json(DAILY));
    server.use(
      http.get(RG_BUDGETS, () =>
        HttpResponse.json({
          value: [
            { name: 'big', properties: { category: 'Cost', amount: 500, timeGrain: 'Monthly' } },
            { name: 'small', properties: { category: 'Cost', amount: 80, timeGrain: 'Monthly' } },
            {
              name: 'part',
              properties: {
                category: 'Cost',
                amount: 10,
                timeGrain: 'Monthly',
                filter: { dimensions: { name: 'ResourceId', operator: 'In', values: ['x'] } },
              },
            },
          ],
        }),
      ),
    );
    const trend = await service().getTrend({
      kind: 'resourceGroup',
      subscriptionId: SUB,
      resourceGroup: 'rg-web',
    });
    expect(bodies[0]?.body).not.toHaveProperty('dataset.filter');
    expect(trend.budget).toEqual({ name: 'small', amount: 80, currency: null });
  });

  it('still returns the trend when budgets fail', async () => {
    answer(RG_QUERY, () => HttpResponse.json(DAILY));
    server.use(
      http.get(RG_BUDGETS, () =>
        HttpResponse.json({ error: { code: 'AuthorizationFailed' } }, { status: 403 }),
      ),
    );
    const trend = await service().getTrend({
      kind: 'resourceGroup',
      subscriptionId: SUB,
      resourceGroup: 'rg-web',
    });
    expect(trend.budget).toBeNull();
    expect(trend.daily.currency).toBe('EUR');
  });

  it('falls back to PreTaxCost when a subscription rejects Cost', async () => {
    answer(SUB_QUERY, (body) => {
      const column = (body.dataset as { aggregation: { totalCost: { name: string } } }).aggregation
        .totalCost.name;
      return column === 'Cost'
        ? HttpResponse.json({ error: { code: 'BadRequest' } }, { status: 400 })
        : HttpResponse.json(DAILY);
    });
    const trend = await service().getTrend({
      kind: 'resource',
      subscriptionId: SUB,
      resourceId: RESOURCE,
    });
    expect(bodies).toHaveLength(2);
    expect(trend.daily.days['2026-11-01']).toBe(2);
  });

  it('refetches once the UTC month has changed, even within the TTL', async () => {
    answer(SUB_QUERY, () => HttpResponse.json(DAILY));
    const trends = service();
    const target = { kind: 'resource', subscriptionId: SUB, resourceId: RESOURCE } as const;
    now = Date.UTC(2026, 10, 30, 23);
    await trends.getTrend(target);
    now = Date.UTC(2026, 11, 1, 0, 30);
    await trends.getTrend(target);
    expect(bodies).toHaveLength(2);
  });
});
