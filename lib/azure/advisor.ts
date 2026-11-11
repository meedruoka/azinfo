import { z } from 'zod';
import { API_VERSIONS } from './api-versions';
import { ARM_HOST, armList } from './arm-client';

/**
 * Only the fields azinfo shows. Advisor's `extendedProperties` is a free-form
 * object, so everything is optional and checked when read.
 */
const Recommendation = z.object({
  name: z.string().nullish(),
  properties: z.object({
    category: z.string().nullish(),
    impact: z.string().nullish(),
    impactedValue: z.string().nullish(),
    shortDescription: z
      .object({ problem: z.string().nullish(), solution: z.string().nullish() })
      .nullish(),
    resourceMetadata: z.object({ resourceId: z.string().nullish() }).nullish(),
    extendedProperties: z.record(z.string(), z.unknown()).nullish(),
  }),
});

type Recommendation = z.infer<typeof Recommendation>;

export interface Savings {
  amount: number;
  currency: string;
  /**
   * `year` when Advisor gave `annualSavingsAmount`. Otherwise the period of
   * `savingsAmount` isn't documented, so it is shown without one.
   */
  period: 'year' | 'unspecified';
}

export interface Tip {
  /** Advisor's recommendation name (a GUID); unique per resource and type. */
  id: string;
  /** Lowercased ARM ID of the resource the tip is about. */
  resourceId: string;
  problem: string;
  solution: string;
  /** High, Medium or Low. */
  impact: string;
  savings?: Savings;
}

/** Shape-only summary for the service worker console: no IDs, text or amounts. */
export interface AdvisorShape {
  recommendations: number;
  withResource: number;
  savingsFields: string[];
}

export function advisorUrl(subscriptionId: string): string {
  const filter = encodeURIComponent("Category eq 'Cost'");
  return `${ARM_HOST}/subscriptions/${subscriptionId}/providers/Microsoft.Advisor/recommendations?api-version=${API_VERSIONS.advisor}&$filter=${filter}`;
}

/** Advisor's cached cost recommendations for a subscription (read-only GET). */
export async function listCostTips(
  subscriptionId: string,
  accessToken: string,
): Promise<{ tips: Tip[]; shape: AdvisorShape }> {
  const raw = await armList(advisorUrl(subscriptionId), accessToken, Recommendation);
  const tips = raw
    .filter((r) => (r.properties.category ?? 'Cost').toLowerCase() === 'cost')
    .map(toTip)
    .filter((t): t is Tip => t !== null);
  const fields = new Set<string>();
  for (const r of raw) {
    for (const key of Object.keys(r.properties.extendedProperties ?? {})) {
      if (/saving/i.test(key)) fields.add(key);
    }
  }
  return {
    tips,
    shape: {
      recommendations: raw.length,
      withResource: tips.length,
      savingsFields: [...fields].sort(),
    },
  };
}

function toTip(r: Recommendation): Tip | null {
  const p = r.properties;
  const resourceId = p.resourceMetadata?.resourceId?.toLowerCase();
  const problem = p.shortDescription?.problem?.trim();
  if (!resourceId || !problem) return null;
  const solution = p.shortDescription?.solution?.trim();
  return {
    id: r.name ?? `${resourceId}:${problem}`,
    resourceId,
    problem,
    // Advisor often repeats the problem as the solution; show it once.
    solution: solution && solution !== problem ? solution : '',
    impact: p.impact ?? '',
    savings: savingsOf(p.extendedProperties ?? {}),
  };
}

export function savingsOf(ext: Record<string, unknown>): Savings | undefined {
  const currency = typeof ext.savingsCurrency === 'string' ? ext.savingsCurrency : '';
  if (!currency) return undefined;
  const annual = positiveNumber(ext.annualSavingsAmount);
  if (annual !== null) return { amount: annual, currency, period: 'year' };
  const plain = positiveNumber(ext.savingsAmount);
  if (plain !== null) return { amount: plain, currency, period: 'unspecified' };
  return undefined;
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Tips grouped by lowercased resource ID. */
export function tipsByResource(tips: Tip[]): Record<string, Tip[]> {
  const out: Record<string, Tip[]> = {};
  const seen = new Set<string>();
  for (const tip of tips) {
    const key = `${tip.resourceId}|${tip.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out[tip.resourceId] ?? [];
    list.push(tip);
    out[tip.resourceId] = list;
  }
  return out;
}

/**
 * Sum of the yearly savings, or null when there are none or they mix
 * currencies or periods (adding those would mislead).
 */
export function totalSavings(tips: Tip[]): Savings | null {
  const withSavings = tips.map((t) => t.savings).filter((s): s is Savings => !!s);
  const first = withSavings[0];
  if (!first) return null;
  if (withSavings.some((s) => s.currency !== first.currency || s.period !== first.period)) {
    return null;
  }
  return { ...first, amount: withSavings.reduce((sum, s) => sum + s.amount, 0) };
}
