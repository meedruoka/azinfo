/** No flag before this many completed days: early projections swing too much. */
export const MIN_DAYS_ELAPSED = 5;

export interface MonthProgress {
  /**
   * Completed UTC days this month (day-of-month − 1). Today is excluded
   * because Azure cost data lags by hours, so today's costs are mostly missing.
   */
  daysElapsed: number;
  daysInMonth: number;
}

export function monthProgress(at: number): MonthProgress {
  const d = new Date(at);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { daysElapsed: d.getUTCDate() - 1, daysInMonth };
}

export interface SpikeAssessment {
  /** Projected month-end cost; null before the first completed day. */
  projected: number | null;
  /** Projected more than the threshold above last month. */
  spike: boolean;
}

/**
 * Projected month-end = month-to-date ÷ days elapsed × days in month. Flags a
 * spike when it is more than `thresholdPct` above last month, and only once
 * {@link MIN_DAYS_ELAPSED} days have elapsed. Never flags when last month was
 * zero or a net credit: there is no baseline to compare against.
 */
export function assessSpike(
  mtd: number,
  lastMonth: number,
  progress: MonthProgress,
  thresholdPct: number,
): SpikeAssessment {
  if (progress.daysElapsed <= 0) return { projected: null, spike: false };
  const projected = (mtd / progress.daysElapsed) * progress.daysInMonth;
  const spike =
    progress.daysElapsed >= MIN_DAYS_ELAPSED &&
    lastMonth > 0 &&
    projected > lastMonth * (1 + thresholdPct / 100);
  return { projected, spike };
}
