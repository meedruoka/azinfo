import { describe, expect, it } from 'vitest';
import { CostShapeError } from './normalise';
import { buildTrendQuery, normaliseTrendRows, summariseTrend, toDayKey } from './trend';

const NOV_4 = Date.UTC(2026, 10, 4, 12);
const ID = '/subscriptions/s/resourcegroups/rg/providers/microsoft.web/sites/App';

describe('buildTrendQuery', () => {
  it('asks for daily cost since the 1st of last month, filtered to one resource', () => {
    expect(buildTrendQuery('Cost', NOV_4, 'AmortizedCost', ID)).toEqual({
      type: 'AmortizedCost',
      timeframe: 'Custom',
      timePeriod: { from: '2026-10-01T00:00:00Z', to: '2026-11-04T23:59:59Z' },
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        filter: { dimensions: { name: 'ResourceId', operator: 'In', values: [ID.toLowerCase()] } },
      },
    });
  });

  it('has no filter for a resource group, whose scope already narrows it', () => {
    expect(buildTrendQuery('PreTaxCost', NOV_4, 'ActualCost').dataset).not.toHaveProperty('filter');
  });
});

describe('normaliseTrendRows', () => {
  const columns = [
    { name: 'Cost', type: 'Number' },
    { name: 'UsageDate', type: 'Number' },
    { name: 'Currency', type: 'String' },
  ];

  it('adds rows up per day and reads the currency', () => {
    expect(
      normaliseTrendRows(columns, [
        [1.5, 20261101, 'EUR'],
        [0.5, 20261101, 'EUR'],
        [2, 20261102, 'EUR'],
      ]),
    ).toEqual({ days: { '2026-11-01': 2, '2026-11-02': 2 }, currency: 'EUR' });
  });

  it('accepts ISO dates and a response without a currency column', () => {
    expect(
      normaliseTrendRows(
        [
          { name: 'PreTaxCost', type: 'Number' },
          { name: 'UsageDate', type: 'Datetime' },
        ],
        [[3, '2026-10-31T00:00:00']],
      ),
    ).toEqual({ days: { '2026-10-31': 3 }, currency: null });
  });

  it('refuses a layout without a date column rather than guessing', () => {
    expect(() => normaliseTrendRows([{ name: 'Cost', type: 'Number' }], [[1]])).toThrow(
      CostShapeError,
    );
  });

  it('reads both date formats', () => {
    expect(toDayKey(20260105)).toBe('2026-01-05');
    expect(toDayKey('2026-01-05T00:00:00')).toBe('2026-01-05');
    expect(toDayKey('nope')).toBeNull();
  });
});

describe('summariseTrend', () => {
  it('compares completed days with the same days last month', () => {
    const summary = summariseTrend(
      {
        days: {
          '2026-10-01': 1,
          '2026-10-02': 1,
          '2026-10-03': 1,
          '2026-10-04': 10,
          '2026-11-01': 2,
          '2026-11-02': 2,
          '2026-11-03': 2,
          // Today: mostly missing, left out of the comparison.
          '2026-11-04': 0.1,
        },
        currency: 'EUR',
      },
      NOV_4,
    );
    expect(summary.daysCompared).toBe(3);
    expect(summary.current).toEqual([2, 4, 6]);
    expect(summary.previous).toHaveLength(31);
    expect(summary.previous[30]).toBe(13);
    expect(summary.sameDays).toEqual({ thisMonth: 6, lastMonth: 3 });
    expect(summary.daysInMonth).toBe(30);
  });

  it('caps the comparison at the end of a shorter last month', () => {
    // 31 March: 30 completed days, February 2026 has 28.
    const at = Date.UTC(2026, 2, 31, 12);
    const days: Record<string, number> = {};
    for (let d = 1; d <= 28; d++) days[`2026-02-${String(d).padStart(2, '0')}`] = 1;
    const summary = summariseTrend({ days, currency: 'EUR' }, at);
    expect(summary.daysCompared).toBe(30);
    expect(summary.sameDays).toEqual({ thisMonth: 0, lastMonth: 28 });
  });

  it('has no comparison on the 1st', () => {
    const summary = summariseTrend({ days: {}, currency: null }, Date.UTC(2026, 10, 1, 9));
    expect(summary.sameDays).toBeNull();
    expect(summary.current).toEqual([]);
  });

  it('handles January against December of the year before', () => {
    const summary = summariseTrend(
      { days: { '2025-12-01': 4, '2026-01-01': 5 }, currency: 'USD' },
      Date.UTC(2026, 0, 2, 12),
    );
    expect(summary.sameDays).toEqual({ thisMonth: 5, lastMonth: 4 });
  });
});
