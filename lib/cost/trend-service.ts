import { ArmError } from '../azure/arm-client';
import { listGroupBudgets, type MonthlyBudget } from '../azure/budgets';
import { runCostQuery } from '../azure/cost-client';
import { createTtlCache } from '../cache/ttl-cache';
import type { CostType } from '../settings';
import type { CostColumnName } from './query';
import { buildTrendQuery, type DailyCosts, normaliseTrendRows } from './trend';

/** What the trend is for: one resource, or a whole resource group. */
export type TrendTarget =
  | { kind: 'resource'; subscriptionId: string; resourceId: string }
  | { kind: 'resourceGroup'; subscriptionId: string; resourceGroup: string };

export interface TrendData {
  daily: DailyCosts;
  fetchedAt: number;
  costType: CostType;
  /** Resource groups only: the group's monthly budget, when one covers all of it. */
  budget: MonthlyBudget | null;
}

export interface TrendServiceDeps {
  getAccessToken: (subscriptionId: string) => Promise<string>;
  ttlMs: () => number | Promise<number>;
  costType: () => CostType | Promise<CostType>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Cache key version: bump when TrendData changes shape. */
export const TREND_CACHE_PREFIX = 'trend.v1.';

const COST_COLUMNS: readonly CostColumnName[] = ['Cost', 'PreTaxCost'];

/**
 * Daily costs per resource or resource group, asked for when a panel opens
 * and after its main figures are shown, so it never delays them. One small
 * query per target per cache period (decision 008).
 */
export function createTrendService(deps: TrendServiceDeps) {
  const now = deps.now ?? Date.now;
  const cache = createTtlCache<TrendData>(TREND_CACHE_PREFIX, deps.ttlMs, now);
  const inFlight = new Map<string, Promise<TrendData>>();
  /** Cost column each subscription accepted, tried first next time (this worker's life). */
  const acceptedColumn = new Map<string, CostColumnName>();
  let generation = 0;

  async function queryDaily(target: TrendTarget, costType: CostType, token: string) {
    const sub = target.subscriptionId.toLowerCase();
    const first = acceptedColumn.get(sub) ?? 'Cost';
    const order = [first, ...COST_COLUMNS.filter((c) => c !== first)];
    const at = now();
    for (const column of order) {
      try {
        const scope =
          target.kind === 'resource'
            ? target.subscriptionId
            : { subscriptionId: target.subscriptionId, resourceGroup: target.resourceGroup };
        const body = buildTrendQuery(
          column,
          at,
          costType,
          target.kind === 'resource' ? target.resourceId : undefined,
        );
        const result = await runCostQuery(scope, body, token, { now, sleep: deps.sleep });
        acceptedColumn.set(sub, column);
        // Shape only (no costs or IDs).
        console.info('[azinfo] trend query', {
          target: target.kind,
          costColumn: column,
          columns: result.columns.map((c) => `${c.name}:${c.type}`),
          rows: result.rows.length,
        });
        return { daily: normaliseTrendRows(result.columns, result.rows), at };
      } catch (e) {
        const isLast = column === order[order.length - 1];
        if (!(e instanceof ArmError && e.status === 400) || isLast) throw e;
      }
    }
    throw new Error('No trend query shape was accepted');
  }

  /** The group's budget, or null. Never throws: a budget is extra. */
  async function groupBudget(target: TrendTarget, token: string): Promise<MonthlyBudget | null> {
    if (target.kind !== 'resourceGroup') return null;
    try {
      const budgets = await listGroupBudgets(target.subscriptionId, target.resourceGroup, token);
      console.info('[azinfo] budgets', { monthlyWholeGroup: budgets.length });
      // Several budgets: the lowest is the one that will be hit first.
      return budgets.sort((a, b) => a.amount - b.amount)[0] ?? null;
    } catch (e) {
      console.warn('[azinfo] budgets unavailable:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  async function load(key: string, target: TrendTarget, costType: CostType, force: boolean) {
    const startedIn = generation;
    const cached = force ? null : await cache.get(key);
    if (cached && sameMonth(cached.value.fetchedAt, now())) return cached.value;
    const token = await deps.getAccessToken(target.subscriptionId);
    const [daily, budget] = await Promise.all([
      queryDaily(target, costType, token),
      groupBudget(target, token),
    ]);
    const value: TrendData = { daily: daily.daily, fetchedAt: daily.at, costType, budget };
    if (startedIn === generation) await cache.set(key, value);
    return value;
  }

  return {
    async getTrend(target: TrendTarget, opts: { force?: boolean } = {}): Promise<TrendData> {
      const costType = await deps.costType();
      const id =
        target.kind === 'resource'
          ? target.resourceId
          : `/subscriptions/${target.subscriptionId}/resourcegroups/${target.resourceGroup}`;
      const key = `${costType.toLowerCase()}.${id.toLowerCase()}`;
      let pending = inFlight.get(key);
      if (!pending) {
        const started = load(key, target, costType, opts.force ?? false).finally(() => {
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
      acceptedColumn.clear();
      await cache.clear();
    },
  };
}

export type TrendService = ReturnType<typeof createTrendService>;

function sameMonth(a: number, b: number): boolean {
  return new Date(a).toISOString().slice(0, 7) === new Date(b).toISOString().slice(0, 7);
}
