import type { MeterShare } from '../cost/breakdown';
import { roundToDisplayed } from '../format';
import type { AssessedCost, ResponseMap, Result, SpikeContext, TipsResult } from '../messages';
import type { CostType } from '../settings';

/** Shared by the resource and resource-group views. */
interface Freshness {
  fetchedAt: number;
  costType: CostType;
  /** Shown from an expired cache entry while a refresh runs. */
  refreshing: boolean;
  /** The refresh after a quick answer failed: the figures shown are old. */
  refreshFailed?: boolean;
}

/** Month-to-date versus all of last month. */
export type Change =
  | { kind: 'percent'; value: number }
  /** Cost this month, none last month. */
  | { kind: 'new' }
  /** Nothing either month. */
  | { kind: 'none' };

type ErrorState =
  | { kind: 'notSignedIn' }
  /** Signed in, but this subscription's tenant needs its own sign-in. */
  | { kind: 'tenantSignIn'; tenantId: string }
  | { kind: 'noCostAccess' }
  | { kind: 'rateLimited'; retryAt?: number }
  | { kind: 'error'; message: string };

export type PanelState =
  /** `signingIn`: a sign-in started from the panel, so a Microsoft window may be waiting. */
  | { kind: 'loading'; rateLimitedUntil?: number; signingIn?: boolean }
  | ErrorState
  | { kind: 'noData'; fetchedAt: number }
  | ({
      kind: 'data';
      mtd: number;
      lastMonth: number;
      currency: string;
      change: Change;
      projected: number | null;
      spike: boolean;
      spikeContext: SpikeContext;
      breakdown: MeterShare[];
      tips: TipsResult;
    } & Freshness)
  | ({
      kind: 'group';
      resources: AssessedCost[];
      total: { mtd: number; lastMonth: number; currency: string } | null;
      spikes: number;
      spikeContext: SpikeContext;
      breakdown: MeterShare[];
      tips: TipsResult;
    } & Freshness);

/**
 * Compares the amounts as the panel shows them, so a fraction of a cent last month
 * (shown as 0.00) never turns into "-100%" next to two zero amounts.
 */
export function changeFrom(rawMtd: number, rawLastMonth: number, currency: string): Change {
  const mtd = roundToDisplayed(rawMtd, currency);
  const lastMonth = roundToDisplayed(rawLastMonth, currency);
  if (lastMonth === 0) return mtd === 0 ? { kind: 'none' } : { kind: 'new' };
  // abs() keeps the sign meaningful when last month was a net credit.
  return { kind: 'percent', value: ((mtd - lastMonth) / Math.abs(lastMonth)) * 100 };
}

export function errorState(result: Extract<Result<unknown>, { ok: false }>): ErrorState {
  switch (result.kind) {
    case 'notSignedIn':
      return { kind: 'notSignedIn' };
    case 'tenantSignIn':
      return result.tenantId
        ? { kind: 'tenantSignIn', tenantId: result.tenantId }
        : { kind: 'error', message: result.message };
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
  const { cost, assessment, spikeContext, fetchedAt, breakdown, tips, stale, costType } =
    result.data;
  if (!cost) return { kind: 'noData', fetchedAt };
  return {
    kind: 'data',
    mtd: cost.mtd,
    lastMonth: cost.lastMonth,
    currency: cost.currency,
    change: changeFrom(cost.mtd, cost.lastMonth, cost.currency),
    projected: assessment?.projected ?? null,
    spike: assessment?.spike ?? false,
    spikeContext,
    fetchedAt,
    costType: costType ?? 'ActualCost',
    refreshing: stale === true,
    breakdown,
    tips,
  };
}

/** Maps the worker's answer for a resource group to what the panel shows. */
export function groupPanelStateFromResult(
  result: Result<ResponseMap['getResourceGroupCosts']>,
): PanelState {
  if (!result.ok) return errorState(result);
  const { resources, total, spikeContext, fetchedAt, breakdown, tips, stale, costType } =
    result.data;
  return {
    kind: 'group',
    resources,
    total,
    spikes: resources.filter((r) => r.assessment.spike).length,
    spikeContext,
    fetchedAt,
    costType: costType ?? 'ActualCost',
    refreshing: stale === true,
    breakdown,
    tips,
  };
}

/**
 * Errors that replace old figures shown during a refresh: the account can't
 * see this subscription any more. Others (throttling, a network error) keep
 * the old figures, marked as not refreshed.
 */
export function replacesOldFigures(state: PanelState): boolean {
  return (
    state.kind === 'notSignedIn' || state.kind === 'tenantSignIn' || state.kind === 'noCostAccess'
  );
}

/** Number of Advisor tips to mention in the collapsed pill. */
export function tipCount(state: PanelState): number {
  if ((state.kind === 'data' || state.kind === 'group') && state.tips.ok) {
    return state.tips.items.length;
  }
  return 0;
}
