import type { Savings, Tip } from './azure/advisor';
import type { DirectorySubscription } from './azure/directory';
import type { MeterShare } from './cost/breakdown';
import type { ResourceCost } from './cost/normalise';
import type { SpikeAssessment } from './cost/spike';

/** Requests from popup/content script to the background worker. */
export type Request =
  | { type: 'getAuthState' }
  /**
   * Home sign-in. `personalTenant`: a personal Microsoft account's own tenant
   * (decision 006); absent for work or school accounts. Ignored when a tenant
   * is set on the options page.
   */
  | { type: 'signIn'; personalTenant?: string }
  /** Interactive sign-in to one more tenant (consent, MFA, device checks there). */
  | { type: 'signInTenant'; tenantId: string }
  | { type: 'signOut' }
  /** All tenants the user belongs to and the subscriptions reachable through them. */
  | { type: 'getDirectory'; force?: boolean }
  | { type: 'getTopCosts'; subscriptionId: string; force?: boolean }
  | {
      type: 'getResourceCost';
      subscriptionId: string;
      resourceId: string;
      /** The portal URL's `#@<tenant>`, used if the subscription isn't in the directory. */
      tenantHint?: string;
      force?: boolean;
    }
  /** null resets to the build default. Signs out: tokens belong to the old authority. */
  | { type: 'setAuthority'; authority: string | null }
  | { type: 'clearCache' }
  | {
      type: 'getResourceGroupCosts';
      subscriptionId: string;
      resourceGroupId: string;
      tenantHint?: string;
      force?: boolean;
    };

/** Error kinds the UI can show a specific message for. */
export type ErrorKind =
  | 'notSignedIn'
  /** Signed in, but this subscription's tenant needs its own sign-in. */
  | 'tenantSignIn'
  | 'noCostAccess'
  | 'rateLimited'
  | 'auth'
  | 'azure'
  | 'unknown';

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: ErrorKind;
      message: string;
      retryAt?: number;
      /** For `tenantSignIn`: the tenant to sign in to. */
      tenantId?: string;
    };

export interface TopCost extends ResourceCost {
  name: string;
  type: string;
}

export interface AssessedCost extends TopCost {
  assessment: SpikeAssessment;
  /** Advisor cost tips for this resource (resource-group view). */
  tipCount?: number;
}

/**
 * Advisor cost tips, fetched alongside the costs. A failure here never fails
 * the cost answer: it only hides the tips.
 */
export type TipsResult =
  | { ok: true; items: Tip[]; total: Savings | null }
  | { ok: false; reason: 'noAccess' | 'error' };

/** Spike settings and timing the worker used; shown so flags are explainable. */
export interface SpikeContext {
  thresholdPct: number;
  daysElapsed: number;
}

export interface DirectoryTenant {
  tenantId: string;
  displayName: string;
  /** Needs an interactive sign-in before its subscriptions can be listed. */
  needsSignIn: boolean;
  /** Listing failed for another reason. */
  error?: string;
}

export interface ResponseMap {
  getAuthState: {
    signedIn: boolean;
    /** No tenant set on the options page: sign-in asks for the account type. */
    chooseAccount: boolean;
    /** Last tenant seen in a portal address this session, for personal accounts. */
    lastPortalTenant: string | null;
  };
  signIn: { signedIn: boolean };
  signInTenant: { signedIn: boolean };
  signOut: { signedIn: boolean };
  getDirectory: {
    tenants: DirectoryTenant[];
    subscriptions: DirectorySubscription[];
    fetchedAt: number;
  };
  setAuthority: { authority: string };
  clearCache: { cleared: true };
  getTopCosts: { subscriptionId: string; fetchedAt: number; top: TopCost[] };
  /** `cost` is null when the resource has no cost rows this month or last. */
  getResourceCost: {
    resourceId: string;
    fetchedAt: number;
    cost: ResourceCost | null;
    assessment: SpikeAssessment | null;
    spikeContext: SpikeContext;
    /** This month by meter category; empty when Azure gave no breakdown. */
    breakdown: MeterShare[];
    tips: TipsResult;
  };
  getResourceGroupCosts: {
    resourceGroupId: string;
    fetchedAt: number;
    /** Sorted by month-to-date cost, highest first. */
    resources: AssessedCost[];
    /** Null when there are no resources or they use different currencies. */
    total: { mtd: number; lastMonth: number; currency: string } | null;
    spikeContext: SpikeContext;
    /** The group's month-to-date by meter category. */
    breakdown: MeterShare[];
    /** Tips for any resource in the group, including ones without cost. */
    tips: TipsResult;
  };
}

export async function sendRequest<R extends Request>(
  request: R,
): Promise<Result<ResponseMap[R['type']]>> {
  return browser.runtime.sendMessage(request);
}
