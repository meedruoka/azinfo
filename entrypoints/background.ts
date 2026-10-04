import { type AuthService, createAuthService, NotSignedInError } from '@/lib/auth/auth-service';
import { readAuthConfig } from '@/lib/auth/config';
import { TokenError } from '@/lib/auth/token-endpoint';
import { ArmError } from '@/lib/azure/arm-client';
import { CostRateLimitError } from '@/lib/azure/cost-client';
import { describeResourceId } from '@/lib/azure/resource-id';
import { listSubscriptions } from '@/lib/azure/subscriptions';
import { type CostService, createCostService } from '@/lib/cost/cost-service';
import { topByMtd } from '@/lib/cost/normalise';
import type { ErrorKind, Request, ResponseMap, Result } from '@/lib/messages';

// Service worker: owns auth, Azure API calls and the cache.
// It is the only network-facing part of the extension.
export default defineBackground(() => {
  let authService: AuthService | undefined;
  let costService: CostService | undefined;

  // Created on first use so a missing client ID surfaces as a popup error
  // instead of a crashed worker.
  const getAuth = () =>
    (authService ??= createAuthService({
      config: readAuthConfig(),
      redirectUri: browser.identity.getRedirectURL(),
      launchWebAuthFlow: (details) => browser.identity.launchWebAuthFlow(details),
    }));

  // Dev-only switch to exercise the rate-limit path once per worker start.
  // MODE is a build-time constant, so production builds drop this entirely.
  let simulate429 =
    import.meta.env.MODE === 'development' && import.meta.env.WXT_DEV_SIMULATE_429 === '1';

  const getCosts = () =>
    (costService ??= createCostService({
      getAccessToken: () => getAuth().getAccessToken(),
      client: {
        takeSimulated429: () => {
          const take = simulate429;
          simulate429 = false;
          return take;
        },
      },
    }));

  async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
    const auth = getAuth();
    switch (request.type) {
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
        return {
          resourceId,
          fetchedAt: costs.fetchedAt,
          cost: costs.resources[resourceId] ?? null,
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
