import { storage } from 'wxt/utils/storage';
import { ArmError } from '../azure/arm-client';
import { type CostClientDeps, runCostQuery } from '../azure/cost-client';
import { createTtlCache } from '../cache/ttl-cache';
import { normaliseCostRows, type ResourceCost } from './normalise';
import { buildCostQuery, type CostColumnName, monthsFor } from './query';

export interface SubscriptionCosts {
  subscriptionId: string;
  resources: Record<string, ResourceCost>;
  /** When the data was fetched from Azure (Azure's own data lags by hours). */
  fetchedAt: number;
  /** Which cost column this subscription accepted, reused on the next fetch. */
  costColumn: CostColumnName;
}

/** Per-subscription fetch state that the popup and in-portal panel watch. */
export type CostStatus = { state: 'rateLimited'; retryAt: number };

/**
 * In local storage, not session: content scripts can't read session storage
 * at its default access level, and widening that level would expose tokens.
 * It only holds a retry time.
 */
export const costStatusItem = storage.defineItem<Record<string, CostStatus>>('local:cost.status', {
  fallback: {},
});

export const DEFAULT_COST_TTL_MS = 4 * 60 * 60 * 1000;

/** Cache key version: bump when SubscriptionCosts changes shape. */
export const COST_CACHE_PREFIX = 'cost.v1.';

export interface CostServiceDeps {
  getAccessToken: () => Promise<string>;
  ttlMs?: () => number | Promise<number>;
  now?: () => number;
  client?: Omit<CostClientDeps, 'onRateLimited' | 'now'>;
}

export function createCostService(deps: CostServiceDeps) {
  const now = deps.now ?? Date.now;
  const cache = createTtlCache<SubscriptionCosts>(
    COST_CACHE_PREFIX,
    deps.ttlMs ?? (() => DEFAULT_COST_TTL_MS),
    now,
  );
  const inFlight = new Map<string, Promise<SubscriptionCosts>>();

  async function setStatus(subscriptionId: string, status: CostStatus | null) {
    const all = { ...(await costStatusItem.getValue()) };
    if (status) all[subscriptionId] = status;
    else delete all[subscriptionId];
    await costStatusItem.setValue(all);
  }

  async function query(subscriptionId: string, costColumn: CostColumnName) {
    const at = now();
    const result = await runCostQuery(
      subscriptionId,
      buildCostQuery(costColumn, at),
      await deps.getAccessToken(),
      {
        ...deps.client,
        now,
        onRateLimited: (retryAt) =>
          void setStatus(subscriptionId, { state: 'rateLimited', retryAt }),
      },
    );
    return { result, at };
  }

  async function fetchFromAzure(
    subscriptionId: string,
    preferred: CostColumnName,
  ): Promise<SubscriptionCosts> {
    let costColumn = preferred;
    let response: Awaited<ReturnType<typeof query>>;
    try {
      response = await query(subscriptionId, costColumn);
    } catch (e) {
      // Agreement types name the cost column differently; a 400 on one name
      // means try the other once.
      if (!(e instanceof ArmError && e.status === 400)) throw e;
      costColumn = costColumn === 'Cost' ? 'PreTaxCost' : 'Cost';
      response = await query(subscriptionId, costColumn);
    } finally {
      await setStatus(subscriptionId, null);
    }
    const { columns, rows, pages } = response.result;
    // Shape only (no costs, IDs or tokens): shows which layout Azure returned.
    console.info('[azinfo] cost query', {
      costColumn,
      columns: columns.map((c) => `${c.name}:${c.type}`),
      rows: rows.length,
      pages,
    });
    const resources = normaliseCostRows(columns, rows, monthsFor(response.at));
    return { subscriptionId, resources, fetchedAt: response.at, costColumn };
  }

  async function load(key: string, force: boolean): Promise<SubscriptionCosts> {
    const cached = force ? null : await cache.get(key);
    // An entry from a previous UTC month labels last month's cost as "this
    // month", so it is stale even within the TTL.
    if (cached && monthsFor(cached.value.fetchedAt).current === monthsFor(now()).current) {
      return cached.value;
    }
    // Reuse the column the subscription accepted last time, even if expired.
    const previous = await storage.getItem<{ value: SubscriptionCosts }>(
      `local:${COST_CACHE_PREFIX}${key}`,
    );
    const costs = await fetchFromAzure(key, previous?.value.costColumn ?? 'Cost');
    await cache.set(key, costs);
    return costs;
  }

  return {
    /** Cached costs if fresh, otherwise one query to Azure (shared by concurrent callers). */
    async getSubscriptionCosts(
      subscriptionId: string,
      opts: { force?: boolean } = {},
    ): Promise<SubscriptionCosts> {
      const key = subscriptionId.toLowerCase();
      // Checked and registered synchronously so concurrent callers share it.
      let pending = inFlight.get(key);
      if (!pending) {
        pending = load(key, opts.force ?? false).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },

    /** Removes all cached cost data and fetch status. */
    async clear(): Promise<void> {
      await cache.clear();
      await costStatusItem.removeValue();
    },
  };
}

export type CostService = ReturnType<typeof createCostService>;
