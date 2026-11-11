/** Cost column to aggregate. Name depends on the billing agreement. */
export type CostColumnName = 'Cost' | 'PreTaxCost';

/**
 * Second grouping, for the "by meter" breakdown. `MeterCategory` is the
 * documented name; `ServiceName` is tried if a scope rejects it; null drops
 * the breakdown rather than the costs.
 */
export type MeterDimension = 'MeterCategory' | 'ServiceName' | null;

/** One accepted combination of cost column and meter grouping. */
export interface QueryShape {
  costColumn: CostColumnName;
  meter: MeterDimension;
}

/**
 * Shapes tried in order until Azure accepts one (a 400 means "try the next").
 * Costs without a breakdown come last, so the breakdown can never cost us
 * the figures themselves.
 */
export const QUERY_SHAPES: readonly QueryShape[] = [
  { costColumn: 'Cost', meter: 'MeterCategory' },
  { costColumn: 'PreTaxCost', meter: 'MeterCategory' },
  { costColumn: 'Cost', meter: 'ServiceName' },
  { costColumn: 'PreTaxCost', meter: 'ServiceName' },
  { costColumn: 'Cost', meter: null },
  { costColumn: 'PreTaxCost', meter: null },
];

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
 * One query covering the 1st of last month until today (UTC), split per month,
 * per resource and (when `shape.meter` is set) per meter category. Gives last
 * month's total, month-to-date and what this month's cost is made of.
 */
export function buildCostQuery(shape: QueryShape, now: number) {
  const { previous } = monthsFor(now);
  const today = new Date(now).toISOString().slice(0, 10);
  const grouping = [{ type: 'Dimension', name: 'ResourceId' }];
  if (shape.meter) grouping.push({ type: 'Dimension', name: shape.meter });
  return {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: {
      from: `${previous}-01T00:00:00Z`,
      to: `${today}T23:59:59Z`,
    },
    dataset: {
      granularity: 'Monthly',
      aggregation: { totalCost: { name: shape.costColumn, function: 'Sum' } },
      grouping,
    },
  };
}
