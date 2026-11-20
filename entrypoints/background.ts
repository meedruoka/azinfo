import { createTipsService, type TipsService } from '@/lib/advisor/tips-service';
import {
  type AuthService,
  createAuthService,
  NotSignedInError,
  TenantSignInRequiredError,
} from '@/lib/auth/auth-service';
import { defaultAuthority, readAuthConfig } from '@/lib/auth/config';
import { lastPortalTenantItem, planSignIn, signInAuthorityItem } from '@/lib/auth/sign-in-choice';
import { TokenError } from '@/lib/auth/token-endpoint';
import { signedInIntentItem } from '@/lib/auth/token-store';
import { type Tip, totalSavings } from '@/lib/azure/advisor';
import { ArmError } from '@/lib/azure/arm-client';
import { CostRateLimitError } from '@/lib/azure/cost-client';
import { createDirectoryService, type DirectoryService } from '@/lib/azure/directory';
import { describeResourceId } from '@/lib/azure/resource-id';
import { meterBreakdown, sumByMeter } from '@/lib/cost/breakdown';
import { type CostService, createCostService } from '@/lib/cost/cost-service';
import { type ResourceCost, topByMtd } from '@/lib/cost/normalise';
import { groupMatcher, resourcesInGroup, totalOf } from '@/lib/cost/resource-group';
import { assessSpike, monthProgress } from '@/lib/cost/spike';
import type { ErrorKind, Request, ResponseMap, Result, TipsResult } from '@/lib/messages';
import { isAllowedRequest, originOf } from '@/lib/sender-policy';
import {
  authorityItem,
  normaliseAuthority,
  readCacheTtlMs,
  readSpikeThresholdPct,
} from '@/lib/settings';

// Service worker: owns auth, Azure API calls and the cache.
// It is the only network-facing part of the extension.
export default defineBackground(() => {
  let auth: { authority: string; service: AuthService } | undefined;
  let costService: CostService | undefined;
  let directoryService: DirectoryService | undefined;
  let tipsService: TipsService | undefined;
  /** Subscription → tenant named in the portal URL ('#@<tenant>'), from panel requests. */
  const tenantHints = new Map<string, string>();

  // Created on first use so a missing client ID surfaces as a popup error
  // instead of a crashed worker; recreated when the authority setting changes.
  async function getAuth(): Promise<AuthService> {
    const config = await readAuthConfig();
    if (auth?.authority !== config.authority) {
      auth = {
        authority: config.authority,
        service: createAuthService({
          config,
          redirectUri: browser.identity.getRedirectURL(),
          launchWebAuthFlow: (details) => browser.identity.launchWebAuthFlow(details),
        }),
      };
    }
    return auth.service;
  }

  // Dev-only switch to exercise the rate-limit path once per worker start.
  // MODE is a build-time constant, so production builds drop this entirely.
  let simulate429 =
    import.meta.env.MODE === 'development' && import.meta.env.WXT_DEV_SIMULATE_429 === '1';

  const getDirectory = () =>
    (directoryService ??= createDirectoryService({
      getAccessToken: async (tenantId) => (await getAuth()).getAccessToken(tenantId),
      ttlMs: readCacheTtlMs,
    }));

  /**
   * Tenant whose token can query a subscription: from the directory, else the
   * portal URL's tenant, else undefined (the configured authority). A broken
   * directory must not break the single-tenant case, so it only warns.
   */
  async function tenantFor(subscriptionId: string): Promise<string | undefined> {
    const hint = tenantHints.get(subscriptionId.toLowerCase());
    try {
      return (await getDirectory().tenantForSubscription(subscriptionId, hint)) ?? hint;
    } catch (e) {
      if (e instanceof NotSignedInError) throw e;
      console.warn('[azinfo] directory unavailable:', e instanceof Error ? e.message : e);
      return hint;
    }
  }

  /** Clears everything derived from the signed-in account. */
  async function clearAccountData() {
    await getCosts().clear();
    await getTips().clear();
    await getDirectory().clear();
    tenantHints.clear();
  }

  const getCosts = () =>
    (costService ??= createCostService({
      getAccessToken: async (subscriptionId) =>
        (await getAuth()).getAccessToken(await tenantFor(subscriptionId)),
      ttlMs: readCacheTtlMs,
      client: {
        takeSimulated429: () => {
          const take = simulate429;
          simulate429 = false;
          return take;
        },
      },
    }));

  const getTips = () =>
    (tipsService ??= createTipsService({
      getAccessToken: async (subscriptionId) =>
        (await getAuth()).getAccessToken(await tenantFor(subscriptionId)),
      ttlMs: readCacheTtlMs,
    }));

  /**
   * Advisor tips matching `belongs`. Never throws: tips are extra, so a
   * failure (no Advisor access, Advisor not set up) only hides them.
   */
  async function tipsFor(
    subscriptionId: string,
    force: boolean | undefined,
    belongs: (resourceId: string) => boolean,
  ): Promise<TipsResult> {
    try {
      const { byResource } = await getTips().getSubscriptionTips(subscriptionId, { force });
      const items: Tip[] = Object.entries(byResource)
        .filter(([resourceId]) => belongs(resourceId))
        .flatMap(([, tips]) => tips);
      return { ok: true, items, total: totalSavings(items) };
    } catch (e) {
      const status = e instanceof ArmError ? e.status : undefined;
      console.warn('[azinfo] advisor unavailable:', e instanceof Error ? e.message : e);
      return { ok: false, reason: status === 403 ? 'noAccess' : 'error' };
    }
  }

  async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
    const auth = await getAuth();
    switch (request.type) {
      case 'setAuthority': {
        const authority = request.authority === null ? null : normaliseAuthority(request.authority);
        if (request.authority !== null && authority === null) {
          throw new Error(`Not a valid tenant: ${request.authority}`);
        }
        // Tokens belong to the old authority: sign out and drop its cost data.
        await auth.signOut();
        await clearAccountData();
        await signInAuthorityItem.removeValue();
        await authorityItem.setValue(authority);
        return { authority: authority ?? defaultAuthority() };
      }
      case 'clearCache':
        // Tenant and subscription names are cached on disk too.
        await clearAccountData();
        return { cleared: true };
      case 'getAuthState': {
        const chooseAccount = (await authorityItem.getValue()) === null;
        const choice = {
          chooseAccount,
          lastPortalTenant: await lastPortalTenantItem.getValue(),
          // Still meant to be signed in (no sign-out): offer "Sign in again" (decision 006).
          returning: await signedInIntentItem.getValue(),
          rememberedTenant: chooseAccount ? await signInAuthorityItem.getValue() : null,
        };
        if (await auth.isSignedIn()) return { signedIn: true, ...choice };
        // Session storage is empty after a browser restart: try a silent
        // sign-in, unless the user explicitly signed out.
        try {
          await auth.getAccessToken();
          return { signedIn: true, ...choice };
        } catch (e) {
          if (e instanceof NotSignedInError) {
            // Microsoft's reason only (e.g. login_required), never a token.
            if (e.reason !== 'signed_out') {
              console.warn('[azinfo] silent sign-in failed:', e.reason, e.detail ?? '');
            }
            return { signedIn: false, ...choice };
          }
          throw e;
        }
      }
      case 'signIn': {
        const plan = planSignIn(
          await authorityItem.getValue(),
          await signInAuthorityItem.getValue(),
          request.personalTenant,
        );
        if (plan.kind === 'invalid') throw new Error(`Not a valid tenant: ${plan.input}`);
        if (plan.kind === 'switch') {
          // Tokens belong to the authority that issued them (decision 006).
          await auth.signOut();
          await clearAccountData();
          if (plan.tenant) await signInAuthorityItem.setValue(plan.tenant);
          else await signInAuthorityItem.removeValue();
        }
        await (await getAuth()).signIn();
        return { signedIn: true };
      }
      case 'signInTenant':
        await auth.signInTenant(request.tenantId);
        // The tenant's subscriptions are reachable now: rebuild the directory.
        await getDirectory().get(true);
        return { signedIn: true };
      case 'signOut':
        await auth.signOut();
        await clearAccountData();
        // The next sign-in asks for the account type again.
        await signInAuthorityItem.removeValue();
        return { signedIn: false };
      case 'getDirectory': {
        const dir = await getDirectory().get(request.force);
        return {
          tenants: dir.tenants.map((t) => ({
            tenantId: t.tenantId,
            displayName: t.displayName,
            needsSignIn: dir.needsSignIn.includes(t.tenantId),
            error: dir.failed.find((f) => f.tenantId === t.tenantId)?.message,
          })),
          subscriptions: dir.subscriptions,
          fetchedAt: dir.fetchedAt,
        };
      }
      case 'getTopCosts': {
        const costs = await getCosts().getSubscriptionCosts(request.subscriptionId, {
          force: request.force,
        });
        const top = topByMtd(costs.resources, 5).map((r) => ({
          ...r,
          ...describeResourceId(r.resourceId),
        }));
        return { subscriptionId: costs.subscriptionId, fetchedAt: costs.fetchedAt, top };
      }
      case 'getResourceCost': {
        rememberHint(request.subscriptionId, request.tenantHint);
        const resourceId = request.resourceId.toLowerCase();
        // Started first so it runs alongside the cost query.
        const tips = tipsFor(request.subscriptionId, request.force, (id) => id === resourceId);
        // Served from the subscription's cached query: navigating between
        // resources makes no extra Azure calls while the cache is fresh.
        const costs = await getCosts().getSubscriptionCosts(request.subscriptionId, {
          force: request.force,
        });
        const cost = costs.resources[resourceId] ?? null;
        const spike = await spikeSettings(costs.fetchedAt);
        return {
          resourceId,
          fetchedAt: costs.fetchedAt,
          cost,
          assessment: cost ? spike.assess(cost) : null,
          spikeContext: spike.context,
          breakdown: meterBreakdown(cost?.byMeter),
          tips: await tips,
        };
      }
      case 'getResourceGroupCosts': {
        rememberHint(request.subscriptionId, request.tenantHint);
        const inThisGroup = groupMatcher(request.resourceGroupId);
        const tips = tipsFor(request.subscriptionId, request.force, inThisGroup);
        const costs = await getCosts().getSubscriptionCosts(request.subscriptionId, {
          force: request.force,
        });
        const inGroup = resourcesInGroup(costs.resources, request.resourceGroupId).sort(
          (a, b) => b.mtd - a.mtd,
        );
        const spike = await spikeSettings(costs.fetchedAt);
        const groupTips = await tips;
        const tipCount = (resourceId: string) =>
          groupTips.ok ? groupTips.items.filter((t) => t.resourceId === resourceId).length : 0;
        return {
          resourceGroupId: request.resourceGroupId.toLowerCase(),
          fetchedAt: costs.fetchedAt,
          resources: inGroup.map((r) => ({
            ...r,
            ...describeResourceId(r.resourceId),
            assessment: spike.assess(r),
            tipCount: tipCount(r.resourceId),
          })),
          total: totalOf(inGroup),
          spikeContext: spike.context,
          breakdown: meterBreakdown(sumByMeter(inGroup)),
          tips: groupTips,
        };
      }
    }
  }

  function rememberHint(subscriptionId: string, hint?: string) {
    if (!hint) return;
    tenantHints.set(subscriptionId.toLowerCase(), hint.toLowerCase());
    // Offered to personal accounts in the popup (decision 006).
    void lastPortalTenantItem.setValue(hint.toLowerCase());
  }

  const self = { id: browser.runtime.id, origin: originOf(browser.runtime.getURL('/')) ?? '' };

  browser.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
    if (!isAllowedRequest(request, sender, self)) {
      console.warn('[azinfo] request refused from', sender.url && originOf(sender.url));
      sendResponse({ ok: false, kind: 'unknown', message: 'Request not allowed' });
      return false;
    }
    handle(request)
      .then((data) => sendResponse({ ok: true, data } satisfies Result<unknown>))
      .catch((e: unknown) => sendResponse(toErrorResult(e)));
    return true; // Keep the channel open for the async response.
  });
});

/**
 * Spike evaluation as of the data's fetch time: month-to-date reflects that
 * moment, so days elapsed must too.
 */
async function spikeSettings(fetchedAt: number) {
  const thresholdPct = await readSpikeThresholdPct();
  const progress = monthProgress(fetchedAt);
  return {
    context: { thresholdPct, daysElapsed: progress.daysElapsed },
    assess: (r: ResourceCost) => assessSpike(r.mtd, r.lastMonth, progress, thresholdPct),
  };
}

function toErrorResult(e: unknown): Result<never> {
  // Error messages never contain tokens (see TokenError / ArmError).
  const message = e instanceof Error ? e.message : String(e);
  let kind: ErrorKind = 'unknown';
  let retryAt: number | undefined;
  let tenantId: string | undefined;
  if (e instanceof NotSignedInError) kind = 'notSignedIn';
  else if (e instanceof TenantSignInRequiredError) {
    kind = 'tenantSignIn';
    tenantId = e.tenantId;
  } else if (e instanceof TokenError) kind = 'auth';
  else if (e instanceof CostRateLimitError) {
    kind = 'rateLimited';
    retryAt = e.retryAt;
  } else if (e instanceof ArmError) kind = e.status === 403 ? 'noCostAccess' : 'azure';
  console.warn('[azinfo]', kind, message);
  return { ok: false, kind, message, retryAt, tenantId };
}
