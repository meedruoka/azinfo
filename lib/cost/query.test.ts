import { describe, expect, it } from 'vitest';
import { buildCostQuery, monthsFor, QUERY_SHAPES } from './query';

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
  it('asks for actual cost from the 1st of last month to today, per month, resource and meter', () => {
    expect(
      buildCostQuery({ costColumn: 'Cost', meter: 'MeterCategory' }, Date.UTC(2026, 9, 4, 18, 30)),
    ).toEqual({
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from: '2026-09-01T00:00:00Z', to: '2026-10-04T23:59:59Z' },
      dataset: {
        granularity: 'Monthly',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [
          { type: 'Dimension', name: 'ResourceId' },
          { type: 'Dimension', name: 'MeterCategory' },
        ],
      },
    });
  });

  it('spans the year boundary in January and uses the given cost column', () => {
    const q = buildCostQuery({ costColumn: 'PreTaxCost', meter: null }, Date.UTC(2026, 0, 2));
    expect(q.timePeriod).toEqual({ from: '2025-12-01T00:00:00Z', to: '2026-01-02T23:59:59Z' });
    expect(q.dataset.aggregation.totalCost.name).toBe('PreTaxCost');
    expect(q.dataset.grouping).toEqual([{ type: 'Dimension', name: 'ResourceId' }]);
  });

  it('never uses more than the 2 groupings the API allows', () => {
    for (const shape of QUERY_SHAPES) {
      expect(
        buildCostQuery(shape, Date.UTC(2026, 9, 4)).dataset.grouping.length,
      ).toBeLessThanOrEqual(2);
    }
  });

  it('tries costs without a breakdown only after every breakdown shape', () => {
    const firstPlain = QUERY_SHAPES.findIndex((s) => s.meter === null);
    expect(QUERY_SHAPES.slice(firstPlain).every((s) => s.meter === null)).toBe(true);
  });
});
