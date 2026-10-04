import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import mca from '@/tests/fixtures/cost-query-mca.json';
import { server } from '@/tests/msw-server';
import { costStatusItem, createCostService } from './cost-service';

const SUB = '00000000-0000-0000-0000-000000000002';
const QUERY_URL = `https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.CostManagement/query`;
const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 4, 12);

describe('cost service', () => {
  let now = START;
  let requests: { costColumn: string }[] = [];

  function service() {
    return createCostService({
      getAccessToken: async () => 'AT',
      now: () => now,
      client: { sleep: async () => {} },
    });
  }

  function respondWith(handler: (costColumn: string) => Response) {
    server.use(
      http.post(QUERY_URL, async ({ request }) => {
        const body = (await request.json()) as {
          dataset: { aggregation: { totalCost: { name: string } } };
        };
        const costColumn = body.dataset.aggregation.totalCost.name;
        requests.push({ costColumn });
        return handler(costColumn);
      }),
    );
  }

  beforeEach(() => {
    fakeBrowser.reset();
    now = START;
    requests = [];
  });

  it('fetches once, then serves from the cache within the TTL without network', async () => {
    respondWith(() => HttpResponse.json(mca));
    const costs = service();

    const first = await costs.getSubscriptionCosts(SUB);
    now += 4 * HOUR - 1;
    const second = await costs.getSubscriptionCosts(SUB);

    expect(requests).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ subscriptionId: SUB, fetchedAt: START, costColumn: 'Cost' });
    expect(Object.keys(first.resources)).toHaveLength(2);
  });

  it('survives a worker restart: a new service instance still hits the cache', async () => {
    respondWith(() => HttpResponse.json(mca));
    await service().getSubscriptionCosts(SUB);
    await service().getSubscriptionCosts(SUB);
    expect(requests).toHaveLength(1);
  });

  it('refetches after the TTL and when forced', async () => {
    respondWith(() => HttpResponse.json(mca));
    const costs = service();
    await costs.getSubscriptionCosts(SUB);
    await costs.getSubscriptionCosts(SUB, { force: true });
    now += 4 * HOUR;
    await costs.getSubscriptionCosts(SUB);
    expect(requests).toHaveLength(3);
  });

  it('shares one request between concurrent callers', async () => {
    respondWith(() => HttpResponse.json(mca));
    const costs = service();
    await Promise.all([costs.getSubscriptionCosts(SUB), costs.getSubscriptionCosts(SUB)]);
    expect(requests).toHaveLength(1);
  });

  it('falls back to PreTaxCost on a 400 and remembers it for the next fetch', async () => {
    respondWith((col) =>
      col === 'Cost'
        ? HttpResponse.json(
            { error: { code: 'BadRequest', message: 'Invalid aggregation column Cost' } },
            { status: 400 },
          )
        : HttpResponse.json(mca),
    );
    const costs = service();
    expect((await costs.getSubscriptionCosts(SUB)).costColumn).toBe('PreTaxCost');

    now += 5 * HOUR;
    await costs.getSubscriptionCosts(SUB);
    expect(requests.map((r) => r.costColumn)).toEqual(['Cost', 'PreTaxCost', 'PreTaxCost']);
  });

  it('records the rate-limited status while waiting and clears it afterwards', async () => {
    let calls = 0;
    respondWith(() =>
      ++calls === 1
        ? new HttpResponse(null, { status: 429, headers: { 'retry-after': '10' } })
        : HttpResponse.json(mca),
    );
    const seen: unknown[] = [];
    const unwatch = costStatusItem.watch((v) => seen.push(v));

    await service().getSubscriptionCosts(SUB);
    unwatch();

    expect(seen).toContainEqual({ [SUB]: { state: 'rateLimited', retryAt: START + 10_000 } });
    expect(await costStatusItem.getValue()).toEqual({});
  });

  it('clear() empties the cache so the next call fetches again', async () => {
    respondWith(() => HttpResponse.json(mca));
    const costs = service();
    await costs.getSubscriptionCosts(SUB);
    await costs.clear();
    await costs.getSubscriptionCosts(SUB);
    expect(requests).toHaveLength(2);
  });
});
