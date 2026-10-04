import { describe, expect, it } from 'vitest';
import { assessSpike, monthProgress } from './spike';

const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

describe('monthProgress', () => {
  it.each([
    ['1st of October', at(2026, 10, 1), 0, 31],
    ['6th of October', at(2026, 10, 6), 5, 31],
    ['last day of October', at(2026, 10, 31, 23), 30, 31],
    ['February, common year', at(2026, 2, 10), 9, 28],
    ['February, leap year', at(2028, 2, 10), 9, 29],
    ['April (30 days)', at(2026, 4, 30), 29, 30],
    ['January', at(2027, 1, 15), 14, 31],
  ])('%s', (_label, now, daysElapsed, daysInMonth) => {
    expect(monthProgress(now)).toEqual({ daysElapsed, daysInMonth });
  });

  it('uses the UTC date, not local time, around midnight', () => {
    expect(monthProgress(Date.UTC(2026, 9, 31, 23, 59, 59)).daysElapsed).toBe(30);
    expect(monthProgress(Date.UTC(2026, 10, 1, 0, 0, 0))).toEqual({
      daysElapsed: 0,
      daysInMonth: 30,
    });
  });
});

describe('assessSpike', () => {
  const oct = (day: number) => monthProgress(at(2026, 10, day));

  it('projects month-to-date over completed days to the whole month', () => {
    // 5 completed days, 31-day month: 50 / 5 * 31 = 310
    expect(assessSpike(50, 300, oct(6), 50)).toEqual({ projected: 310, spike: false });
  });

  it('flags only when the projection is more than the threshold above last month', () => {
    // 5 days elapsed of 31; last month 100; threshold 50% → limit 150.
    const exactly150 = (150 / 31) * 5;
    expect(assessSpike(exactly150, 100, oct(6), 50).spike).toBe(false);
    expect(assessSpike(exactly150 + 0.01, 100, oct(6), 50).spike).toBe(true);
  });

  it('does not flag before 5 days have elapsed, however high the projection', () => {
    expect(assessSpike(1000, 10, oct(5), 50)).toMatchObject({ spike: false });
    expect(assessSpike(1000, 10, oct(6), 50)).toMatchObject({ spike: true });
  });

  it('has no projection on the 1st of the month', () => {
    expect(assessSpike(5, 10, oct(1), 50)).toEqual({ projected: null, spike: false });
  });

  it('never flags without a positive baseline', () => {
    expect(assessSpike(100, 0, oct(20), 50).spike).toBe(false);
    expect(assessSpike(100, -20, oct(20), 50).spike).toBe(false);
  });

  it('accounts for short months', () => {
    // Same spend rate, 10 completed days: February 28 days vs. October 31 days.
    const feb = monthProgress(at(2026, 2, 11));
    expect(assessSpike(100, 0, feb, 50).projected).toBe(280);
    expect(assessSpike(100, 0, oct(11), 50).projected).toBe(310);
    // Last month 200, limit 300: February projects 280 (no flag), October 310 (flag).
    expect(assessSpike(100, 200, feb, 50).spike).toBe(false);
    expect(assessSpike(100, 200, oct(11), 50).spike).toBe(true);
  });

  it('handles the leap-year February and the last day of the month', () => {
    expect(assessSpike(28, 0, monthProgress(at(2028, 2, 29)), 50).projected).toBe(29);
    expect(assessSpike(30, 0, oct(31), 50).projected).toBe(31);
  });

  it('respects a different threshold', () => {
    expect(assessSpike(25, 100, oct(11), 0).spike).toBe(false); // projects 77.5
    expect(assessSpike(40, 100, oct(11), 0).spike).toBe(true); // projects 124
  });
});
