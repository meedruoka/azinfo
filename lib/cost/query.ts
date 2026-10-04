/** Cost column to aggregate. Name depends on the billing agreement. */
export type CostColumnName = 'Cost' | 'PreTaxCost';

/** Calendar months covered by one query, as `YYYY-MM` (UTC). */
export interface QueryMonths {
  current: string;
  previous: string;
}

export function monthsFor(now: number): QueryMonths {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { current: monthKey(y, m), previous: monthKey(m === 0 ? y - 1 : y, (m + 11) % 12) };
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/**
 * One query covering the 1st of last month until today (UTC), split per month
 * and per resource. Gives both last month's total and month-to-date.
 */
export function buildCostQuery(costColumn: CostColumnName, now: number) {
  const { previous } = monthsFor(now);
  const today = new Date(now).toISOString().slice(0, 10);
  return {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: {
      from: `${previous}-01T00:00:00Z`,
      to: `${today}T23:59:59Z`,
    },
    dataset: {
      granularity: 'Monthly',
      aggregation: { totalCost: { name: costColumn, function: 'Sum' } },
      grouping: [{ type: 'Dimension', name: 'ResourceId' }],
    },
  };
}
