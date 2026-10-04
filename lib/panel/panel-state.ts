import type { ResponseMap, Result } from '../messages';

/** Month-to-date versus all of last month. */
export type Change =
  | { kind: 'percent'; value: number }
  /** Cost this month, none last month. */
  | { kind: 'new' }
  /** Nothing either month. */
  | { kind: 'none' };

export type PanelState =
  | { kind: 'loading'; rateLimitedUntil?: number }
  | { kind: 'notSignedIn' }
  | { kind: 'noCostAccess' }
  | { kind: 'noData'; fetchedAt: number }
  | { kind: 'rateLimited'; retryAt?: number }
  | { kind: 'error'; message: string }
  | {
      kind: 'data';
      mtd: number;
      lastMonth: number;
      currency: string;
      change: Change;
      fetchedAt: number;
    };

export function changeFrom(mtd: number, lastMonth: number): Change {
  if (lastMonth === 0) return mtd === 0 ? { kind: 'none' } : { kind: 'new' };
  // abs() keeps the sign meaningful when last month was a net credit.
  return { kind: 'percent', value: ((mtd - lastMonth) / Math.abs(lastMonth)) * 100 };
}

/** Maps the worker's answer to what the panel shows. */
export function panelStateFromResult(result: Result<ResponseMap['getResourceCost']>): PanelState {
  if (!result.ok) {
    switch (result.kind) {
      case 'notSignedIn':
        return { kind: 'notSignedIn' };
      case 'noCostAccess':
        return { kind: 'noCostAccess' };
      case 'rateLimited':
        return { kind: 'rateLimited', retryAt: result.retryAt };
      default:
        return { kind: 'error', message: result.message };
    }
  }
  const { cost, fetchedAt } = result.data;
  if (!cost) return { kind: 'noData', fetchedAt };
  return {
    kind: 'data',
    mtd: cost.mtd,
    lastMonth: cost.lastMonth,
    currency: cost.currency,
    change: changeFrom(cost.mtd, cost.lastMonth),
    fetchedAt,
  };
}
