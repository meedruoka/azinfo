import { z } from 'zod';
import { API_VERSIONS } from './api-versions';
import { ARM_HOST, ArmError } from './arm-client';

/**
 * The only POST the extension may send: Cost Management's read-only query.
 * nextLinks use `Query` with a capital Q, hence case-insensitive.
 */
const COST_QUERY_PATH =
  /^\/subscriptions\/[0-9a-f-]+\/providers\/microsoft\.costmanagement\/query$/i;

/** Max pages followed per query; guards against a nextLink loop. */
const MAX_PAGES = 50;

const QueryColumn = z.object({ name: z.string(), type: z.string() });
const QueryResponse = z.object({
  properties: z.object({
    columns: z.array(QueryColumn),
    rows: z.array(z.array(z.unknown())),
    nextLink: z.string().nullish(),
  }),
});

export type QueryColumn = z.infer<typeof QueryColumn>;

export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  /** Number of pages fetched (nextLinks followed + 1). */
  pages: number;
}

export interface RetryPolicy {
  maxRetries: number;
  /** Floor for every wait, even if Azure asks for less. */
  minDelayMs: number;
  /** Longest wait the worker sits through; beyond it, give up and report. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  minDelayMs: 5_000,
  maxDelayMs: 60_000,
};

export interface CostClientDeps {
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called before each wait so the UI can show "rate limited, retrying". */
  onRateLimited?: (retryAt: number) => void;
  /** Dev-only: answer the next request with a synthetic 429. */
  takeSimulated429?: () => boolean;
}

/** Throttled and not retried further. `retryAt` is when Azure allows the next call. */
export class CostRateLimitError extends Error {
  constructor(readonly retryAt: number) {
    super('Cost Management is rate limiting requests');
    this.name = 'CostRateLimitError';
  }
}

export function costQueryUrl(subscriptionId: string): string {
  return `${ARM_HOST}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${API_VERSIONS.costQuery}`;
}

/** Runs a query and follows every nextLink (re-POSTing the same body). */
export async function runCostQuery(
  subscriptionId: string,
  body: unknown,
  accessToken: string,
  deps: CostClientDeps = {},
): Promise<QueryResult> {
  let columns: QueryColumn[] = [];
  const rows: unknown[][] = [];
  const seen = new Set<string>();
  let next: string | null | undefined = costQueryUrl(subscriptionId);
  let pages = 0;

  for (let page = 0; next; page++) {
    // Partial data would show wrong totals, so stop with an error instead.
    if (page >= MAX_PAGES) throw new Error(`Cost query exceeded ${MAX_PAGES} pages`);
    if (seen.has(next)) throw new Error('Cost query returned a repeating nextLink');
    seen.add(next);

    const result = await postWithRetry(next, body, accessToken, deps);
    pages++;
    if (!result) break; // 204: no data for the period.
    if (page === 0) columns = result.properties.columns;
    rows.push(...result.properties.rows);
    next = result.properties.nextLink;
  }
  return { columns, rows, pages };
}

async function postWithRetry(
  url: string,
  body: unknown,
  accessToken: string,
  deps: CostClientDeps,
): Promise<z.infer<typeof QueryResponse> | null> {
  const policy = deps.retry ?? DEFAULT_RETRY_POLICY;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  for (let attempt = 0; ; attempt++) {
    const res = deps.takeSimulated429?.()
      ? simulated429()
      : await postQuery(url, body, accessToken);

    if (res.status === 429 || res.status === 503) {
      const asked = retryAfterMs(res.headers, now());
      const backoff = policy.minDelayMs * 2 ** attempt;
      const delay = Math.max(asked ?? 0, backoff);
      const retryAt = now() + delay;
      if (attempt >= policy.maxRetries || delay > policy.maxDelayMs) {
        throw new CostRateLimitError(retryAt);
      }
      deps.onRateLimited?.(retryAt);
      await sleep(delay);
      continue;
    }

    if (res.status === 204) return null;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toArmError(res.status, json);
    return QueryResponse.parse(json);
  }
}

function postQuery(url: string, body: unknown, accessToken: string): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.origin !== ARM_HOST || !COST_QUERY_PATH.test(parsed.pathname)) {
    throw new Error(`Refusing POST to non-query URL: ${parsed.origin}${parsed.pathname}`);
  }
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Longest wait requested by `Retry-After` or any Cost Management
 * `x-ms-ratelimit-microsoft.costmanagement-*-retry-after` header (qpu, entity,
 * tenant, client...). Values are seconds; `Retry-After` may also be a date.
 */
export function retryAfterMs(headers: Headers, now: number): number | null {
  let max: number | null = null;
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    const isCostHeader = /^x-ms-ratelimit-microsoft\.costmanagement-.*retry-after$/.test(lower);
    if (lower !== 'retry-after' && !isCostHeader) return;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(ms) && ms >= 0) max = Math.max(max ?? 0, ms);
  });
  return max;
}

const ArmErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

function toArmError(status: number, json: unknown): ArmError {
  const err = ArmErrorBody.safeParse(json);
  return err.success
    ? new ArmError(status, err.data.error.code, err.data.error.message ?? err.data.error.code)
    : new ArmError(status, 'http_error', `Cost Management returned HTTP ${status}`);
}

function simulated429(): Response {
  return new Response(null, {
    status: 429,
    headers: { 'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '5' },
  });
}
