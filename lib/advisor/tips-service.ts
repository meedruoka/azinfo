import { listCostTips, type Tip, tipsByResource } from '../azure/advisor';
import { createTtlCache } from '../cache/ttl-cache';

export interface SubscriptionTips {
  /** Lowercased resource ID → its cost tips. */
  byResource: Record<string, Tip[]>;
  fetchedAt: number;
}

export interface TipsServiceDeps {
  /** Token for the tenant that can read this subscription. */
  getAccessToken: (subscriptionId: string) => Promise<string>;
  ttlMs: () => number | Promise<number>;
  now?: () => number;
}

export const TIPS_CACHE_PREFIX = 'advisor.v1.';

/**
 * Advisor cost tips per subscription: one GET per subscription per cache
 * period, cached next to the cost data and cleared with it.
 */
export function createTipsService(deps: TipsServiceDeps) {
  const now = deps.now ?? Date.now;
  const cache = createTtlCache<SubscriptionTips>(TIPS_CACHE_PREFIX, deps.ttlMs, now);
  const inFlight = new Map<string, Promise<SubscriptionTips>>();
  /** Bumped by clear(): a request that started before it must not refill the cache. */
  let generation = 0;

  async function load(key: string, force: boolean): Promise<SubscriptionTips> {
    const startedIn = generation;
    const cached = force ? null : await cache.get(key);
    if (cached) return cached.value;
    const { tips, shape } = await listCostTips(key, await deps.getAccessToken(key));
    // Shape only (no IDs, text or amounts): shows what Advisor returned.
    console.info('[azinfo] advisor', shape);
    const value = { byResource: tipsByResource(tips), fetchedAt: now() };
    if (startedIn === generation) await cache.set(key, value);
    return value;
  }

  return {
    /** Cached tips if fresh, otherwise one Advisor request (shared by concurrent callers). */
    getSubscriptionTips(
      subscriptionId: string,
      opts: { force?: boolean } = {},
    ): Promise<SubscriptionTips> {
      const key = subscriptionId.toLowerCase();
      let pending = inFlight.get(key);
      if (!pending) {
        const started = load(key, opts.force ?? false).finally(() => {
          if (inFlight.get(key) === started) inFlight.delete(key);
        });
        pending = started;
        inFlight.set(key, pending);
      }
      return pending;
    },

    async clear(): Promise<void> {
      generation++;
      inFlight.clear();
      await cache.clear();
    },
  };
}

export type TipsService = ReturnType<typeof createTipsService>;
