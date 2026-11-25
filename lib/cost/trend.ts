import type { QueryColumn } from '../azure/cost-client';
import type { CostType } from '../settings';
import { CostShapeError, toNumber } from './normalise';
import { type CostColumnName, monthsFor } from './query';
import { monthProgress } from './spike';

/** Daily cost of one resource or resource group: `YYYY-MM-DD` (UTC) → cost. */
export interface DailyCosts {
  days: Record<string, number>;
  /** Null when the response carried no currency column. */
  currency: string | null;
}

/**
 * Daily cost from the 1st of last month until today (UTC), for one resource
 * (`resourceId` filter) or for the scope the query runs at (a resource group).
 * No grouping: a handful of rows, so it answers quickly (decision 008).
 */
export function buildTrendQuery(
  costColumn: CostColumnName,
  now: number,
  costType: CostType,
  resourceId?: string,
) {
  const { previous } = monthsFor(now);
  const today = new Date(now).toISOString().slice(0, 10);
  return {
    type: costType,
    timeframe: 'Custom',
    timePeriod: { from: `${previous}-01T00:00:00Z`, to: `${today}T23:59:59Z` },
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: costColumn, function: 'Sum' } },
      ...(resourceId && {
        filter: {
          dimensions: { name: 'ResourceId', operator: 'In', values: [resourceId.toLowerCase()] },
        },
      }),
    },
  };
}

const COST_NAMES = ['cost', 'pretaxcost', 'totalcost', 'costinbillingcurrency'];
const DATE_NAMES = ['usagedate', 'date'];
const CURRENCY_NAMES = ['currency', 'billingcurrency'];

/** Rows → day → cost. Columns are found by name; a missing cost or date column is an error. */
export function normaliseTrendRows(columns: QueryColumn[], rows: unknown[][]): DailyCosts {
  if (rows.length === 0) return { days: {}, currency: null };
  const lower = columns.map((c) => c.name.toLowerCase());
  const find = (names: string[]) => names.map((n) => lower.indexOf(n)).find((i) => i >= 0) ?? null;
  const cost = find(COST_NAMES);
  const date = find(DATE_NAMES);
  const currencyCol = find(CURRENCY_NAMES);
  if (cost === null || date === null) {
    throw new CostShapeError(
      `Trend response has no ${cost === null ? 'cost' : 'date'} column (columns: ${columns.map((c) => c.name).join(', ')})`,
    );
  }
  const days: Record<string, number> = {};
  let currency: string | null = null;
  for (const row of rows) {
    const day = toDayKey(row[date]);
    if (!day) continue;
    days[day] = (days[day] ?? 0) + toNumber(row[cost]);
    if (currencyCol !== null && !currency) currency = String(row[currencyCol] ?? '') || null;
  }
  return { days, currency };
}

/** UsageDate comes as 20261103 (number) or "2026-11-03T00:00:00". */
export function toDayKey(value: unknown): string | null {
  const s = String(value ?? '');
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export interface TrendSummary {
  /** Running total for each completed day of this month (index 0 = the 1st). */
  current: number[];
  /** Running total for every day of last month. */
  previous: number[];
  /** Completed days this month: today is left out, its data is mostly missing. */
  daysCompared: number;
  /** This month's completed days, and last month's same days; null on the 1st. */
  sameDays: { thisMonth: number; lastMonth: number } | null;
  daysInMonth: number;
}

/**
 * Running totals for this month and last, and the like-for-like comparison:
 * the first N completed days of this month against the first N days of last
 * month (N capped at last month's length).
 */
export function summariseTrend(daily: DailyCosts, at: number): TrendSummary {
  const { current: thisKey, previous: lastKey } = monthsFor(at);
  const { daysElapsed, daysInMonth } = monthProgress(at);
  const lastLength = daysIn(lastKey);
  const running = (month: string, count: number) => {
    const out: number[] = [];
    let sum = 0;
    for (let d = 1; d <= count; d++) {
      sum += daily.days[`${month}-${String(d).padStart(2, '0')}`] ?? 0;
      out.push(sum);
    }
    return out;
  };
  const current = running(thisKey, daysElapsed);
  const previous = running(lastKey, lastLength);
  const sameDays =
    daysElapsed > 0
      ? {
          thisMonth: current[daysElapsed - 1] ?? 0,
          lastMonth: previous[Math.min(daysElapsed, lastLength) - 1] ?? 0,
        }
      : null;
  return { current, previous, daysCompared: daysElapsed, sameDays, daysInMonth };
}

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
