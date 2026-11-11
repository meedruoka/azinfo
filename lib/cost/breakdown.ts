import type { ResourceCost } from './normalise';

export interface MeterShare {
  category: string;
  amount: number;
  /** Fraction of the total, 0..1. */
  share: number;
}

/** Label for the categories folded together after the top ones. */
export const OTHER_METERS = 'Other';

/** Adds up the per-meter costs of several resources (a resource group). */
export function sumByMeter(resources: ResourceCost[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of resources) {
    for (const [category, amount] of Object.entries(r.byMeter ?? {})) {
      out[category] = (out[category] ?? 0) + amount;
    }
  }
  return out;
}

/**
 * The `top` largest categories, then everything else as "Other". Empty when
 * there is nothing to split: no breakdown, or a total of zero or less
 * (credits), where shares would mean nothing.
 */
export function meterBreakdown(byMeter: Record<string, number> | undefined, top = 4): MeterShare[] {
  const entries = Object.entries(byMeter ?? {}).filter(([, amount]) => amount !== 0);
  const total = entries.reduce((s, [, amount]) => s + amount, 0);
  if (entries.length === 0 || total <= 0) return [];

  entries.sort((a, b) => b[1] - a[1]);
  const head = entries.slice(0, top);
  const restTotal = entries.slice(top).reduce((s, [, amount]) => s + amount, 0);
  const rows = head.map(([category, amount]) => ({ category, amount }));
  if (restTotal !== 0) {
    const existing = rows.find((r) => r.category === OTHER_METERS);
    if (existing) existing.amount += restTotal;
    else rows.push({ category: OTHER_METERS, amount: restTotal });
  }
  return rows.map((r) => ({ ...r, share: r.amount / total }));
}
