import { z } from 'zod';
import { API_VERSIONS } from './api-versions';
import { ARM_HOST, armList } from './arm-client';

/** Only the fields azinfo reads; everything else is ignored. */
const Budget = z.object({
  name: z.string().nullish(),
  properties: z.object({
    category: z.string().nullish(),
    amount: z.number().nullish(),
    timeGrain: z.string().nullish(),
    currentSpend: z.object({ amount: z.number().nullish(), unit: z.string().nullish() }).nullish(),
    filter: z.unknown().nullish(),
  }),
});

type RawBudget = z.infer<typeof Budget>;

/** A monthly cost budget that covers its whole scope (no filter). */
export interface MonthlyBudget {
  name: string;
  amount: number;
  /** Currency of `currentSpend`, when Azure gave one. */
  currency: string | null;
}

export function budgetsUrl(subscriptionId: string, resourceGroup: string): string {
  return `${ARM_HOST}/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Consumption/budgets?api-version=${API_VERSIONS.budgets}`;
}

/**
 * Monthly cost budgets set on a resource group (read-only GET). Budgets with a
 * filter cover only part of the group, so a line for them would mislead: they
 * are left out.
 */
export async function listGroupBudgets(
  subscriptionId: string,
  resourceGroup: string,
  accessToken: string,
): Promise<MonthlyBudget[]> {
  const raw = await armList(budgetsUrl(subscriptionId, resourceGroup), accessToken, Budget);
  return raw.flatMap((b) => {
    const budget = toMonthlyBudget(b);
    return budget ? [budget] : [];
  });
}

export function toMonthlyBudget(b: RawBudget): MonthlyBudget | null {
  const p = b.properties;
  if ((p.category ?? 'Cost').toLowerCase() !== 'cost') return null;
  if (!/^(monthly|billingmonth)$/i.test(p.timeGrain ?? '')) return null;
  if (typeof p.amount !== 'number' || !(p.amount > 0)) return null;
  if (hasFilter(p.filter)) return null;
  return { name: b.name ?? '', amount: p.amount, currency: p.currentSpend?.unit ?? null };
}

/** True when the filter object narrows the budget (dimensions, tags or a nested `and`). */
function hasFilter(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  return Object.values(filter as Record<string, unknown>).some(
    (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
  );
}
