import type { Subscription } from './azure/subscriptions';
import type { ResourceCost } from './cost/normalise';
import type { SpikeAssessment } from './cost/spike';

/** Requests from popup/content script to the background worker. */
export type Request =
  | { type: 'getAuthState' }
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'listSubscriptions' }
  | { type: 'getTopCosts'; subscriptionId: string; force?: boolean }
  | { type: 'getResourceCost'; subscriptionId: string; resourceId: string; force?: boolean }
  | {
      type: 'getResourceGroupCosts';
      subscriptionId: string;
      resourceGroupId: string;
      force?: boolean;
    };

/** Error kinds the UI can show a specific message for. */
export type ErrorKind =
  | 'notSignedIn'
  | 'noCostAccess'
  | 'rateLimited'
  | 'auth'
  | 'azure'
  | 'unknown';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ErrorKind; message: string; retryAt?: number };

export interface TopCost extends ResourceCost {
  name: string;
  type: string;
}

export interface AssessedCost extends TopCost {
  assessment: SpikeAssessment;
}

/** Spike settings and timing the worker used; shown so flags are explainable. */
export interface SpikeContext {
  thresholdPct: number;
  daysElapsed: number;
}

export interface ResponseMap {
  getAuthState: { signedIn: boolean };
  signIn: { signedIn: boolean };
  signOut: { signedIn: boolean };
  listSubscriptions: Subscription[];
  getTopCosts: { subscriptionId: string; fetchedAt: number; top: TopCost[] };
  /** `cost` is null when the resource has no cost rows this month or last. */
  getResourceCost: {
    resourceId: string;
    fetchedAt: number;
    cost: ResourceCost | null;
    assessment: SpikeAssessment | null;
    spikeContext: SpikeContext;
  };
  getResourceGroupCosts: {
    resourceGroupId: string;
    fetchedAt: number;
    /** Sorted by month-to-date cost, highest first. */
    resources: AssessedCost[];
    /** Null when there are no resources or they use different currencies. */
    total: { mtd: number; lastMonth: number; currency: string } | null;
    spikeContext: SpikeContext;
  };
}

export async function sendRequest<R extends Request>(
  request: R,
): Promise<Result<ResponseMap[R['type']]>> {
  return browser.runtime.sendMessage(request);
}
