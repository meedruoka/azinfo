import { TenantSignInRequiredError } from '../auth/auth-service';
import { createTtlCache } from '../cache/ttl-cache';
import { mapLimit } from '../map-limit';
import { listSubscriptions, type Subscription } from './subscriptions';
import { listTenants, type Tenant } from './tenants';

export interface DirectorySubscription extends Subscription {
  /**
   * Tenant whose token listed this subscription, and so can query it. For
   * Lighthouse-delegated subscriptions this is the managing tenant, not the
   * subscription's own `tenantId` (where the user usually has no account).
   */
  accessTenantId: string;
}

export interface Directory {
  tenants: Tenant[];
  subscriptions: DirectorySubscription[];
  /** Tenants that need an interactive sign-in (consent, MFA, device checks). */
  needsSignIn: string[];
  /** Tenants that failed for another reason, with a short message. */
  failed: { tenantId: string; message: string }[];
  fetchedAt: number;
}

export interface DirectoryDeps {
  /** Token for a tenant, or for the configured authority when omitted. */
  getAccessToken: (tenantId?: string) => Promise<string>;
  ttlMs: () => number | Promise<number>;
  now?: () => number;
  /** Tenants queried in parallel; keeps first-open bursts small. */
  concurrency?: number;
}

export const DIRECTORY_CACHE_PREFIX = 'directory.v1.';

export function createDirectoryService(deps: DirectoryDeps) {
  const now = deps.now ?? Date.now;
  const cache = createTtlCache<Directory>(DIRECTORY_CACHE_PREFIX, deps.ttlMs, now);
  let inFlight: Promise<Directory> | null = null;
  /** Bumped by clear(): a build that started before it must not refill the cache. */
  let generation = 0;

  async function build(): Promise<Directory> {
    const tenants = await listTenants(await deps.getAccessToken());
    // Only tenants the user belongs to can issue tokens; Lighthouse
    // relations (ProjectedBy / ManagedBy) show up via the home tenant.
    const memberTenants = tenants.filter((t) => t.category === 'Home');
    const needsSignIn: string[] = [];
    const failed: Directory['failed'] = [];

    const perTenant = await mapLimit(memberTenants, deps.concurrency ?? 4, async (tenant) => {
      try {
        const subs = await listSubscriptions(await deps.getAccessToken(tenant.tenantId));
        return subs.map((s) => ({
          ...s,
          subscriptionId: s.subscriptionId.toLowerCase(),
          accessTenantId: tenant.tenantId,
        }));
      } catch (e) {
        if (e instanceof TenantSignInRequiredError) needsSignIn.push(tenant.tenantId);
        else failed.push({ tenantId: tenant.tenantId, message: (e as Error).message });
        return [];
      }
    });

    // A subscription reachable through several tenants is kept once.
    const seen = new Set<string>();
    const subscriptions = perTenant.flat().filter((s) => {
      if (seen.has(s.subscriptionId)) return false;
      seen.add(s.subscriptionId);
      return true;
    });

    return { tenants: memberTenants, subscriptions, needsSignIn, failed, fetchedAt: now() };
  }

  async function get(force = false): Promise<Directory> {
    const startedIn = generation;
    if (!force) {
      const cached = await cache.get('all');
      if (cached) return cached.value;
    }
    if (inFlight && startedIn === generation) return inFlight;
    const started = build()
      .then(async (dir) => {
        if (startedIn === generation) await cache.set('all', dir);
        return dir;
      })
      .finally(() => {
        if (inFlight === started) inFlight = null;
      });
    inFlight = started;
    return started;
  }

  return {
    get,

    /**
     * Tenant to use for a subscription: the one that listed it, else the
     * tenant named in the portal URL (`#@<domain or ID>`), else undefined
     * (meaning the configured authority).
     */
    async tenantForSubscription(
      subscriptionId: string,
      portalTenantHint?: string,
    ): Promise<string | undefined> {
      const dir = await get();
      const sub = dir.subscriptions.find((s) => s.subscriptionId === subscriptionId.toLowerCase());
      if (sub) return sub.accessTenantId;
      return matchTenant(dir.tenants, portalTenantHint)?.tenantId;
    },

    async clear(): Promise<void> {
      generation++;
      inFlight = null;
      await cache.clear();
    },
  };
}

/** Finds the tenant a portal URL's `@<domain or ID>` refers to. */
export function matchTenant(tenants: Tenant[], hint?: string): Tenant | undefined {
  const h = hint?.trim().toLowerCase();
  if (!h) return undefined;
  return tenants.find((t) => t.tenantId === h || t.domains.includes(h));
}

export type DirectoryService = ReturnType<typeof createDirectoryService>;
