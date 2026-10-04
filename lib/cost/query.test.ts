import { describe, expect, it } from 'vitest';
import { buildCostQuery, monthsFor } from './query';

describe('monthsFor', () => {
  it('returns the current and previous UTC month', () => {
    expect(monthsFor(Date.UTC(2026, 9, 4))).toEqual({ current: '2026-10', previous: '2026-09' });
  });

  it('rolls back into December of the previous year in January', () => {
    expect(monthsFor(Date.UTC(2026, 0, 15))).toEqual({ current: '2026-01', previous: '2025-12' });
  });

  it('uses UTC, not local time, at a month boundary', () => {
    expect(monthsFor(Date.UTC(2026, 9, 31, 23, 59))).toMatchObject({ current: '2026-10' });
    expect(monthsFor(Date.UTC(2026, 10, 1, 0, 0))).toMatchObject({ current: '2026-11' });
  });
});

describe('buildCostQuery', () => {
  it('asks for actual cost from the 1st of last month to today, per month and resource', () => {
    expect(buildCostQuery('Cost', Date.UTC(2026, 9, 4, 18, 30))).toEqual({
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from: '2026-09-01T00:00:00Z', to: '2026-10-04T23:59:59Z' },
      dataset: {
        granularity: 'Monthly',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [{ type: 'Dimension', name: 'ResourceId' }],
      },
    });
  });

  it('spans the year boundary in January and uses the given cost column', () => {
    const q = buildCostQuery('PreTaxCost', Date.UTC(2026, 0, 2));
    expect(q.timePeriod).toEqual({ from: '2025-12-01T00:00:00Z', to: '2026-01-02T23:59:59Z' });
    expect(q.dataset.aggregation.totalCost.name).toBe('PreTaxCost');
  });
});
