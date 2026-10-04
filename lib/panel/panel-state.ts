import type { AssessedCost, ResponseMap, Result, SpikeContext } from '../messages';

/** Month-to-date versus all of last month. */
export type Change =
  | { kind: 'percent'; value: number }
  /** Cost this month, none last month. */
  | { kind: 'new' }
  /** Nothing either month. */
  | { kind: 'none' };

type ErrorState =
  | { kind: 'notSignedIn' }
  | { kind: 'noCostAccess' }
  | { kind: 'rateLimited'; retryAt?: number }
  | { kind: 'error'; message: string };

export type PanelState =
  | { kind: 'loading'; rateLimitedUntil?: number }
  | ErrorState
  | { kind: 'noData'; fetchedAt: number }
  | {
      kind: 'data';
      mtd: number;
      lastMonth: number;
      currency: string;
      change: Change;
      projected: number | null;
      spike: boolean;
      spikeContext: SpikeContext;
      fetchedAt: number;
    }
  | {
      kind: 'group';
      resources: AssessedCost[];
      total: { mtd: number; lastMonth: number; currency: string } | null;
      spikes: number;
      spikeContext: SpikeContext;
      fetchedAt: number;
    };

export function changeFrom(mtd: number, lastMonth: number): Change {
  if (lastMonth === 0) return mtd === 0 ? { kind: 'none' } : { kind: 'new' };
  // abs() keeps the sign meaningful when last month was a net credit.
  return { kind: 'percent', value: ((mtd - lastMonth) / Math.abs(lastMonth)) * 100 };
}

export function errorState(result: Extract<Result<unknown>, { ok: false }>): ErrorState {
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

/** Maps the worker's answer for a single resource to what the panel shows. */
export function panelStateFromResult(result: Result<ResponseMap['getResourceCost']>): PanelState {
  if (!result.ok) return errorState(result);
  const { cost, assessment, spikeContext, fetchedAt } = result.data;
  if (!cost) return { kind: 'noData', fetchedAt };
  return {
    kind: 'data',
    mtd: cost.mtd,
    lastMonth: cost.lastMonth,
    currency: cost.currency,
    change: changeFrom(cost.mtd, cost.lastMonth),
    projected: assessment?.projected ?? null,
    spike: assessment?.spike ?? false,
    spikeContext,
    fetchedAt,
  };
}

/** Maps the worker's answer for a resource group to what the panel shows. */
export function groupPanelStateFromResult(
  result: Result<ResponseMap['getResourceGroupCosts']>,
): PanelState {
  if (!result.ok) return errorState(result);
  const { resources, total, spikeContext, fetchedAt } = result.data;
  return {
    kind: 'group',
    resources,
    total,
    spikes: resources.filter((r) => r.assessment.spike).length,
    spikeContext,
    fetchedAt,
  };
}
