import type { QueryColumn } from '../azure/cost-client';
import type { QueryMonths } from './query';

export interface ResourceCost {
  /** Lowercased ARM resource ID. */
  resourceId: string;
  mtd: number;
  lastMonth: number;
  currency: string;
  /**
   * This month's cost per meter category ("Virtual Machines", "Storage"…),
   * when the query was grouped by meter. Absent otherwise.
   */
  byMeter?: Record<string, number>;
}

/** Label for rows whose meter category is empty. */
export const UNNAMED_METER = 'Other';

/** The response doesn't match any column layout we know. */
export class CostShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostShapeError';
  }
}

/** Accepted names per role, case-insensitive, in order of preference. */
const COLUMN_NAMES = {
  cost: ['cost', 'pretaxcost', 'totalcost', 'costinbillingcurrency'],
  currency: ['currency', 'billingcurrency'],
  resourceId: ['resourceid'],
  month: ['billingmonth', 'usagedate', 'billingperiod'],
} as const;

type Role = keyof typeof COLUMN_NAMES;

/** Optional: present only when the query grouped by meter. */
const METER_COLUMN_NAMES = ['metercategory', 'servicename'];

/** Finds each column by name; never assumes positions. */
export function detectColumns(
  columns: QueryColumn[],
): Record<Role, number> & { meter: number | null } {
  const lower = columns.map((c) => c.name.toLowerCase());
  const found = {} as Record<Role, number> & { meter: number | null };
  for (const role of Object.keys(COLUMN_NAMES) as Role[]) {
    const index = COLUMN_NAMES[role].map((name) => lower.indexOf(name)).find((i) => i >= 0);
    if (index === undefined) {
      throw new CostShapeError(
        `Cost response has no ${role} column (columns: ${columns.map((c) => c.name).join(', ')})`,
      );
    }
    found[role] = index;
  }
  found.meter = METER_COLUMN_NAMES.map((name) => lower.indexOf(name)).find((i) => i >= 0) ?? null;
  return found;
}

/**
 * Rows → resource ID → { mtd, lastMonth, currency, byMeter }. Rows for other months
 * are ignored, and so are rows without a resource ID (e.g. support plans).
 */
export function normaliseCostRows(
  columns: QueryColumn[],
  rows: unknown[][],
  months: QueryMonths,
): Record<string, ResourceCost> {
  if (rows.length === 0) return {};
  const col = detectColumns(columns);
  const out: Record<string, ResourceCost> = {};

  for (const row of rows) {
    const resourceId = String(row[col.resourceId] ?? '').toLowerCase();
    if (!resourceId) continue;
    const month = toMonthKey(row[col.month]);
    if (month !== months.current && month !== months.previous) continue;
    const cost = toNumber(row[col.cost]);
    const currency = String(row[col.currency] ?? '');

    let entry = out[resourceId];
    if (!entry) {
      entry = { resourceId, mtd: 0, lastMonth: 0, currency };
      out[resourceId] = entry;
    }
    if (month === months.current) {
      entry.mtd += cost;
      if (col.meter !== null) {
        const meter = String(row[col.meter] ?? '').trim() || UNNAMED_METER;
        entry.byMeter ??= {};
        entry.byMeter[meter] = (entry.byMeter[meter] ?? 0) + cost;
      }
    } else {
      entry.lastMonth += cost;
    }
  }
  return out;
}

/** UsageDate comes as 20260901 (number); BillingMonth as "2026-09-01T00:00:00". */
export function toMonthKey(value: unknown): string | null {
  const s = String(value ?? '');
  const compact = /^(\d{4})(\d{2})\d{2}$/.exec(s);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const iso = /^(\d{4})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}` : null;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new CostShapeError(`Non-numeric cost value: ${String(value)}`);
  return n;
}

/** Highest month-to-date cost first. */
export function topByMtd(resources: Record<string, ResourceCost>, n: number): ResourceCost[] {
  return Object.values(resources)
    .sort((a, b) => b.mtd - a.mtd)
    .slice(0, n);
}
