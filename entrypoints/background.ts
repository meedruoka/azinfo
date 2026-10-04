import { type AuthService, createAuthService, NotSignedInError } from '@/lib/auth/auth-service';
import { defaultAuthority, readAuthConfig } from '@/lib/auth/config';
import { TokenError } from '@/lib/auth/token-endpoint';
import { ArmError } from '@/lib/azure/arm-client';
import { CostRateLimitError } from '@/lib/azure/cost-client';
import { describeResourceId } from '@/lib/azure/resource-id';
import { listSubscriptions } from '@/lib/azure/subscriptions';
import { type CostService, createCostService } from '@/lib/cost/cost-service';
import { type ResourceCost, topByMtd } from '@/lib/cost/normalise';
import { resourcesInGroup, totalOf } from '@/lib/cost/resource-group';
import { assessSpike, monthProgress } from '@/lib/cost/spike';
import type { ErrorKind, Request, ResponseMap, Result } from '@/lib/messages';
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

  const getCosts = () =>
    (costService ??= createCostService({
      getAccessToken: async () => (await getAuth()).getAccessToken(),
      ttlMs: readCacheTtlMs,
      client: {
        takeSimulated429: () => {
          const take = simulate429;
          simulate429 = false;
          return take;
        },
      },
    }));

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
        await getCosts().clear();
        await authorityItem.setValue(authority);
        return { authority: authority ?? defaultAuthority() };
      }
      case 'clearCache':
        await getCosts().clear();
        return { cleared: true };
      case 'getAuthState':
        if (await auth.isSignedIn()) return { signedIn: true };
        // Session storage is empty after a browser restart: try a silent
        // sign-in, unless the user explicitly signed out.
        try {
          await auth.getAccessToken();
          return { signedIn: true };
        } catch (e) {
          if (e instanceof NotSignedInError) return { signedIn: false };
          throw e;
        }
      case 'signIn':
        await auth.signIn();
        return { signedIn: true };
      case 'signOut':
        await auth.signOut();
        await getCosts().clear();
        return { signedIn: false };
      case 'listSubscriptions':
        return listSubscriptions(await auth.getAccessToken());
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
        // Served from the subscription's cached query: navigating between
        // resources makes no extra Azure calls while the cache is fresh.
        const costs = await getCosts().getSubscriptionCosts(request.subscriptionId, {
          force: request.force,
        });
        const resourceId = request.resourceId.toLowerCase();
        const cost = costs.resources[resourceId] ?? null;
        const spike = await spikeSettings(costs.fetchedAt);
        return {
          resourceId,
          fetchedAt: costs.fetchedAt,
          cost,
          assessment: cost ? spike.assess(cost) : null,
          spikeContext: spike.context,
        };
      }
      case 'getResourceGroupCosts': {
        const costs = await getCosts().getSubscriptionCosts(request.subscriptionId, {
          force: request.force,
        });
        const inGroup = resourcesInGroup(costs.resources, request.resourceGroupId).sort(
          (a, b) => b.mtd - a.mtd,
        );
        const spike = await spikeSettings(costs.fetchedAt);
        return {
          resourceGroupId: request.resourceGroupId.toLowerCase(),
          fetchedAt: costs.fetchedAt,
          resources: inGroup.map((r) => ({
            ...r,
            ...describeResourceId(r.resourceId),
            assessment: spike.assess(r),
          })),
          total: totalOf(inGroup),
          spikeContext: spike.context,
        };
      }
    }
  }

  browser.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
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
  if (e instanceof NotSignedInError) kind = 'notSignedIn';
  else if (e instanceof TokenError) kind = 'auth';
  else if (e instanceof CostRateLimitError) {
    kind = 'rateLimited';
    retryAt = e.retryAt;
  } else if (e instanceof ArmError) kind = e.status === 403 ? 'noCostAccess' : 'azure';
  console.warn('[azinfo]', kind, message);
  return { ok: false, kind, message, retryAt };
}
