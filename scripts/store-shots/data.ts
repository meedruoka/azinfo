// Fictional sample data for store screenshots. No real tenant, subscription,
// resource or cost appears here: names are invented and IDs are all-zero.
import type { Tip } from '@/lib/azure/advisor';
import { type MeterShare, OTHER_METERS } from '@/lib/cost/breakdown';
import type { AssessedCost, Request, ResponseMap, Result, TipsResult } from '@/lib/messages';
import { type PortalContext, parsePortalUrl } from '@/lib/portal/parse-portal-url';

const SUB = '00000000-0000-0000-0000-000000000001';
const DEV_SUB = '00000000-0000-0000-0000-000000000002';
const TENANT = '00000000-0000-0000-0000-0000000000aa';
const PARTNER = '00000000-0000-0000-0000-0000000000bb';
const RG_PATH = `https://portal.azure.com/#@example.onmicrosoft.com/resource/subscriptions/${SUB}/resourceGroups/rg-shop-prod`;

/** 19 November, 09:45 local time: "Updated 09:45 AM". */
const FETCHED_AT = new Date(2026, 10, 19, 9, 45).getTime();
const SPIKE_CONTEXT = { thresholdPct: 50, daysElapsed: 19 };
const USD = 'USD';

export const contexts = {
  web: parsePortalUrl(
    `${RG_PATH}/providers/Microsoft.Web/sites/shop-web/overview`,
  ) as PortalContext,
  batch: parsePortalUrl(
    `${RG_PATH}/providers/Microsoft.Compute/virtualMachines/shop-batch-vm/overview`,
  ) as PortalContext,
  group: parsePortalUrl(`${RG_PATH}/overview`) as PortalContext,
};

const shares = (rows: [string, number][]): MeterShare[] => {
  const total = rows.reduce((sum, [, amount]) => sum + amount, 0);
  return rows.map(([category, amount]) => ({ category, amount, share: amount / total }));
};

const webTip: Tip = {
  id: 'sample-1',
  resourceId: contexts.web.resourceId,
  problem: 'Right-size or shutdown underutilized App Service plans',
  solution: 'Move to a smaller App Service plan tier',
  impact: 'High',
  savings: { amount: 1140, currency: USD, period: 'year' },
};
const tips = (items: Tip[]): TipsResult => ({
  ok: true,
  items,
  total: items.length
    ? {
        amount: items.reduce((sum, t) => sum + (t.savings?.amount ?? 0), 0),
        currency: USD,
        period: 'year',
      }
    : null,
});

type Cost = ResponseMap['getResourceCost'];
const resourceCost = (
  context: PortalContext,
  mtd: number,
  lastMonth: number,
  projected: number,
  spike: boolean,
  breakdown: MeterShare[],
  tipList: Tip[],
): Cost => ({
  resourceId: context.resourceId,
  fetchedAt: FETCHED_AT,
  costType: 'ActualCost',
  cost: { resourceId: context.resourceId, mtd, lastMonth, currency: USD },
  assessment: { projected, spike },
  spikeContext: SPIKE_CONTEXT,
  breakdown,
  tips: tips(tipList),
});

const costs: Record<string, Cost> = {
  [contexts.web.resourceId]: resourceCost(
    contexts.web,
    412.3,
    598.1,
    651.0,
    false,
    shares([
      ['Azure App Service', 371.07],
      ['Bandwidth', 28.86],
      ['Storage', 12.37],
    ]),
    [webTip],
  ),
  [contexts.batch.resourceId]: resourceCost(
    contexts.batch,
    486.2,
    301.5,
    767.7,
    true,
    shares([
      ['Virtual Machines', 452.17],
      ['Storage', 21.88],
      ['Bandwidth', 12.15],
    ]),
    [],
  ),
};

const row = (
  type: string,
  provider: string,
  name: string,
  mtd: number,
  lastMonth: number,
  spike = false,
  tipCount = 0,
): AssessedCost => ({
  resourceId: `${contexts.group.resourceId}/providers/${provider}/${name}`,
  name,
  type,
  mtd,
  lastMonth,
  currency: USD,
  assessment: { projected: (mtd / 19) * 30, spike },
  tipCount,
});

const groupRows: AssessedCost[] = [
  row(
    'microsoft.compute/virtualmachines',
    'microsoft.compute/virtualmachines',
    'shop-batch-vm',
    486.2,
    301.5,
    true,
  ),
  row('microsoft.web/sites', 'microsoft.web/sites', 'shop-web', 412.3, 598.1, false, 1),
  row(
    'microsoft.sql/servers/databases',
    'microsoft.sql/servers/shop-sql/databases',
    'orders',
    268.9,
    401.2,
  ),
  row('microsoft.cache/redis', 'microsoft.cache/redis', 'shop-cache', 96.4, 152.0),
  row(
    'microsoft.storage/storageaccounts',
    'microsoft.storage/storageaccounts',
    'shopassets',
    41.75,
    63.9,
  ),
  row(
    'microsoft.insights/components',
    'microsoft.insights/components',
    'shop-insights',
    18.2,
    27.4,
  ),
];
// The group view shows 4 resources so the whole panel fits in a 1280×800 shot
// (the panel scrolls past the window height, and a scrolled-off part can't be captured).
const groupView = groupRows.slice(0, 4);
const sum = (key: 'mtd' | 'lastMonth') => groupView.reduce((s, r) => s + r[key], 0);

const group: ResponseMap['getResourceGroupCosts'] = {
  resourceGroupId: contexts.group.resourceId,
  fetchedAt: FETCHED_AT,
  costType: 'ActualCost',
  resources: groupView,
  total: { mtd: sum('mtd'), lastMonth: sum('lastMonth'), currency: USD },
  spikeContext: SPIKE_CONTEXT,
  breakdown: shares([
    ['Virtual Machines', 452.17],
    ['Azure App Service', 371.07],
    ['SQL Database', 268.9],
    [OTHER_METERS, 171.66],
  ]),
  tips: tips([webTip]),
};

const directory: ResponseMap['getDirectory'] = {
  tenants: [
    { tenantId: TENANT, displayName: 'Example Ltd', needsSignIn: false },
    { tenantId: PARTNER, displayName: 'Partner tenant', needsSignIn: true },
  ],
  subscriptions: [
    { subscriptionId: SUB, displayName: 'Production', state: 'Enabled', accessTenantId: TENANT },
    {
      subscriptionId: DEV_SUB,
      displayName: 'Development',
      state: 'Enabled',
      accessTenantId: TENANT,
    },
  ],
  fetchedAt: FETCHED_AT,
};

const topCosts: ResponseMap['getTopCosts'] = {
  subscriptionId: SUB,
  fetchedAt: FETCHED_AT,
  costType: 'ActualCost',
  top: groupRows.slice(0, 5).map(({ assessment: _a, tipCount: _t, ...cost }) => cost),
};

const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/**
 * Running totals that end at the sample's month-to-date (18 completed days,
 * a gentle weekday rhythm) and last month's total over October's 31 days.
 */
function sampleTrend(mtd: number, lastMonth: number, budget: number | null) {
  const rhythm = (day: number) => 1 + 0.25 * Math.sin(day * 0.9);
  const running = (total: number, days: number, creep: number) => {
    const weights = Array.from({ length: days }, (_, i) => rhythm(i) * (1 + creep * i));
    const scale = total / weights.reduce((a, b) => a + b, 0);
    let sum = 0;
    return weights.map((w) => (sum += w * scale));
  };
  const daysCompared = 18;
  const current = running(mtd * (18 / 18.6), daysCompared, 0.02);
  const previous = running(lastMonth, 31, 0);
  return ok({
    summary: {
      current,
      previous,
      daysCompared,
      sameDays: { thisMonth: current[17] ?? 0, lastMonth: previous[17] ?? 0 },
      daysInMonth: 30,
    },
    currency: USD,
    budget: budget === null ? null : { name: 'shop-prod-monthly', amount: budget, currency: USD },
    fetchedAt: FETCHED_AT,
  });
}

/** Answers the UI's requests the way the background worker would. */
export async function sampleRequest(req: Request): Promise<Result<unknown>> {
  switch (req.type) {
    case 'getAuthState':
      return ok({ signedIn: true });
    case 'getDirectory':
      return ok(directory);
    case 'getTopCosts':
      return ok({ ...topCosts, subscriptionId: req.subscriptionId });
    case 'getResourceCost':
      return ok(costs[req.resourceId]);
    case 'getResourceGroupCosts':
      return ok(group);
    case 'getTrend': {
      if (req.target.kind === 'resourceGroup') {
        return sampleTrend(group.total?.mtd ?? 0, group.total?.lastMonth ?? 0, 2400);
      }
      const cost = costs[req.target.resourceId]?.cost;
      return sampleTrend(cost?.mtd ?? 0, cost?.lastMonth ?? 0, null);
    }
    default:
      return ok({});
  }
}
