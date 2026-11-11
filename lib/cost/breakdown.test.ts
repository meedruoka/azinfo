import { describe, expect, it } from 'vitest';
import { meterBreakdown, sumByMeter } from './breakdown';

describe('meterBreakdown', () => {
  it('lists the largest categories first with their share', () => {
    expect(meterBreakdown({ Storage: 2, 'Virtual Machines': 6, Bandwidth: 2 })).toEqual([
      { category: 'Virtual Machines', amount: 6, share: 0.6 },
      { category: 'Storage', amount: 2, share: 0.2 },
      { category: 'Bandwidth', amount: 2, share: 0.2 },
    ]);
  });

  it('folds everything after the top ones into Other, merging an existing Other', () => {
    const rows = meterBreakdown({ A: 5, B: 4, Other: 1, C: 0.5, D: 0.5 }, 2);
    expect(rows.map((r) => [r.category, r.amount])).toEqual([
      ['A', 5],
      ['B', 4],
      ['Other', 2],
    ]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });

  it('returns nothing without a breakdown or with a zero or negative total', () => {
    expect(meterBreakdown(undefined)).toEqual([]);
    expect(meterBreakdown({})).toEqual([]);
    expect(meterBreakdown({ A: 0 })).toEqual([]);
    expect(meterBreakdown({ A: 2, Credit: -5 })).toEqual([]);
  });
});

describe('sumByMeter', () => {
  it('adds categories across resources and ignores resources without a breakdown', () => {
    const base = { mtd: 0, lastMonth: 0, currency: 'EUR' };
    expect(
      sumByMeter([
        { ...base, resourceId: 'a', byMeter: { VM: 2, Storage: 1 } },
        { ...base, resourceId: 'b', byMeter: { Storage: 3 } },
        { ...base, resourceId: 'c' },
      ]),
    ).toEqual({ VM: 2, Storage: 4 });
  });
});
