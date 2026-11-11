import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import advisor from '@/tests/fixtures/advisor-cost.json';
import { server } from '@/tests/msw-server';
import { advisorUrl, listCostTips, savingsOf, type Tip, totalSavings } from '../azure/advisor';
import { createTipsService } from './tips-service';

const SUB = '00000000-0000-0000-0000-000000000003';
const RG = `/subscriptions/${SUB}/resourcegroups/rg-test`;
const VM = `${RG}/providers/microsoft.compute/virtualmachines/vm1`;
const ST = `${RG}/providers/microsoft.storage/storageaccounts/st1`;
const URL_PATH = `https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.Advisor/recommendations`;
const HOUR = 3_600_000;

function advisorResponds(body: unknown = advisor, status = 200) {
  const urls: string[] = [];
  server.use(
    http.get(URL_PATH, ({ request }) => {
      urls.push(request.url);
      return HttpResponse.json(body as object, { status });
    }),
  );
  return urls;
}

describe('listCostTips', () => {
  beforeEach(() => fakeBrowser.reset());

  it('asks only for cost recommendations, with a GET to ARM', async () => {
    const urls = advisorResponds();
    await listCostTips(SUB, 'AT');
    const url = new URL(urls[0] as string);
    expect(url.searchParams.get('$filter')).toBe("Category eq 'Cost'");
    expect(url.searchParams.get('api-version')).toBe('2025-01-01');
    expect(advisorUrl(SUB)).toContain(URL_PATH);
  });

  it('maps recommendations to tips with lowercased IDs and savings', async () => {
    advisorResponds();
    const { tips, shape } = await listCostTips(SUB, 'AT');
    expect(tips[0]).toEqual({
      id: '11111111-aaaa-0000-0000-000000000000',
      resourceId: VM,
      problem: 'Right-size or shutdown underutilized virtual machines',
      // Same text as the problem: not repeated.
      solution: '',
      impact: 'High',
      savings: { amount: 486, currency: 'EUR', period: 'year' },
    });
    expect(tips[1]).toMatchObject({
      resourceId: ST,
      solution: 'Move infrequently used blobs to the cool tier',
      savings: { amount: 12, currency: 'EUR', period: 'unspecified' },
    });
    expect(shape).toEqual({
      recommendations: 3,
      withResource: 3,
      savingsFields: ['annualSavingsAmount', 'savingsAmount', 'savingsCurrency'],
    });
  });

  it('skips recommendations without a resource or a description', async () => {
    advisorResponds({
      value: [
        { properties: { category: 'Cost', shortDescription: { problem: 'x' } } },
        { properties: { category: 'Cost', resourceMetadata: { resourceId: VM } } },
      ],
    });
    expect((await listCostTips(SUB, 'AT')).tips).toEqual([]);
  });
});

describe('savings', () => {
  it('needs a currency and a positive amount', () => {
    expect(savingsOf({ savingsAmount: '10' })).toBeUndefined();
    expect(savingsOf({ savingsAmount: '0', savingsCurrency: 'EUR' })).toBeUndefined();
    expect(savingsOf({ savingsAmount: 'n/a', savingsCurrency: 'EUR' })).toBeUndefined();
    expect(savingsOf({ savingsAmount: 7, savingsCurrency: 'USD' })).toEqual({
      amount: 7,
      currency: 'USD',
      period: 'unspecified',
    });
  });

  it('totals only matching currency and period', () => {
    const tip = (
      amount: number,
      currency = 'EUR',
      period: 'year' | 'unspecified' = 'year',
    ): Tip => ({
      id: String(amount),
      resourceId: VM,
      problem: 'p',
      solution: '',
      impact: 'Low',
      savings: { amount, currency, period },
    });
    expect(totalSavings([tip(100), tip(50)])).toEqual({
      amount: 150,
      currency: 'EUR',
      period: 'year',
    });
    expect(totalSavings([tip(100), tip(50, 'USD')])).toBeNull();
    expect(totalSavings([tip(100), tip(50, 'EUR', 'unspecified')])).toBeNull();
    expect(totalSavings([])).toBeNull();
  });
});

describe('tips service', () => {
  let now = Date.UTC(2026, 9, 5, 12);
  const service = () =>
    createTipsService({ getAccessToken: async () => 'AT', ttlMs: () => 4 * HOUR, now: () => now });

  beforeEach(() => {
    fakeBrowser.reset();
    now = Date.UTC(2026, 9, 5, 12);
  });

  it('groups tips by resource and serves them from the cache within the TTL', async () => {
    const urls = advisorResponds();
    const tips = service();
    const first = await tips.getSubscriptionTips(SUB.toUpperCase());
    expect(Object.keys(first.byResource).sort()).toEqual([`/subscriptions/${SUB}`, ST, VM].sort());

    now += 4 * HOUR - 1;
    await tips.getSubscriptionTips(SUB);
    expect(urls).toHaveLength(1);
    now += 1;
    await tips.getSubscriptionTips(SUB);
    expect(urls).toHaveLength(2);
  });

  it('does not cache a request that finishes after clear()', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get(URL_PATH, async () => {
        await gate;
        return HttpResponse.json(advisor);
      }),
    );
    const tips = service();
    const pending = tips.getSubscriptionTips(SUB);
    await new Promise((r) => setTimeout(r, 20));
    await tips.clear();
    release();
    await pending;
    expect(Object.keys(await fakeBrowser.storage.local.get())).not.toContain(`advisor.v1.${SUB}`);
  });

  it('surfaces Advisor errors to the caller', async () => {
    advisorResponds({ error: { code: 'AuthorizationFailed', message: 'no' } }, 403);
    await expect(service().getSubscriptionTips(SUB)).rejects.toMatchObject({ status: 403 });
  });
});
