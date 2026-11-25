import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import legacy from '@/tests/fixtures/cost-query-legacy.json';
import legacyPage2 from '@/tests/fixtures/cost-query-legacy-page2.json';
import { server } from '@/tests/msw-server';
import { ArmError } from './arm-client';
import { CostRateLimitError, retryAfterMs, runCostQuery } from './cost-client';

const SUB = '00000000-0000-0000-0000-000000000001';
const QUERY_URL = `https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.CostManagement/query`;
const NOW = 1_700_000_000_000;
const BODY = { type: 'ActualCost' };
const EMPTY = { properties: { columns: [], rows: [], nextLink: null } };

const noSleep = () => {
  const sleep = vi.fn(async (_ms: number) => {});
  return { sleep, now: () => NOW };
};

describe('runCostQuery', () => {
  it('POSTs the body with the token and pinned api-version, then follows nextLink with the same body', async () => {
    const seen: { url: string; body: unknown; auth: string | null }[] = [];
    // MSW matches paths case-insensitively, so one handler serves both pages.
    server.use(
      http.post(QUERY_URL, async ({ request }) => {
        seen.push({
          url: request.url,
          body: await request.json(),
          auth: request.headers.get('authorization'),
        });
        const isPage2 = new URL(request.url).searchParams.has('$skiptoken');
        return HttpResponse.json(isPage2 ? legacyPage2 : legacy);
      }),
    );

    const result = await runCostQuery(SUB, BODY, 'AT', noSleep());

    expect(new URL(seen[0]?.url ?? '').searchParams.get('api-version')).toBe('2026-06-01');
    expect(new URL(seen[1]?.url ?? '').searchParams.get('$skiptoken')).toBe('AQAAAA==');
    expect(seen.map((s) => s.body)).toEqual([BODY, BODY]);
    expect(seen.every((s) => s.auth === 'Bearer AT')).toBe(true);
    expect(result.rows).toHaveLength(5);
    expect(result.columns.map((c) => c.name)).toEqual([
      'PreTaxCost',
      'UsageDate',
      'ResourceId',
      'Currency',
    ]);
  });

  it('stops with an error on a repeating nextLink instead of returning partial data', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_URL, () => {
        calls++;
        return HttpResponse.json({
          properties: { ...legacy.properties, nextLink: `${QUERY_URL}?$skiptoken=same` },
        });
      }),
    );
    await expect(runCostQuery(SUB, BODY, 'AT', noSleep())).rejects.toThrow('repeating nextLink');
    expect(calls).toBe(2);
  });

  it('treats HTTP 204 as no data', async () => {
    server.use(http.post(QUERY_URL, () => new HttpResponse(null, { status: 204 })));
    expect(await runCostQuery(SUB, BODY, 'AT', noSleep())).toEqual({
      columns: [],
      rows: [],
      pages: 1,
    });
  });

  it('waits for the longest Cost Management retry header, then succeeds', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_URL, () => {
        calls++;
        return calls === 1
          ? new HttpResponse(null, {
              status: 429,
              headers: {
                'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '8',
                'x-ms-ratelimit-microsoft.costmanagement-entity-retry-after': '20',
              },
            })
          : HttpResponse.json(EMPTY);
      }),
    );
    const deps = noSleep();
    const onRateLimited = vi.fn();

    await runCostQuery(SUB, BODY, 'AT', { ...deps, onRateLimited });

    expect(calls).toBe(2);
    expect(deps.sleep).toHaveBeenCalledWith(20_000);
    expect(onRateLimited).toHaveBeenCalledWith(NOW + 20_000);
  });

  it('never waits less than the minimum, and backs off exponentially', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_URL, () => {
        calls++;
        return calls <= 2
          ? new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } })
          : HttpResponse.json(EMPTY);
      }),
    );
    const deps = noSleep();
    await runCostQuery(SUB, BODY, 'AT', deps);
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 10_000]);
  });

  it('gives up with CostRateLimitError after the maximum retries', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_URL, () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const deps = noSleep();
    const err = await runCostQuery(SUB, BODY, 'AT', deps).catch((e) => e);
    expect(err).toBeInstanceOf(CostRateLimitError);
    expect(calls).toBe(4); // first try + 3 retries
    expect(deps.sleep).toHaveBeenCalledTimes(3);
  });

  it('does not sit through a wait longer than the maximum delay', async () => {
    server.use(
      http.post(
        QUERY_URL,
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { 'x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after': '300' },
          }),
      ),
    );
    const deps = noSleep();
    const err = await runCostQuery(SUB, BODY, 'AT', deps).catch((e) => e);
    expect(err).toBeInstanceOf(CostRateLimitError);
    expect(err.retryAt).toBe(NOW + 300_000);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('answers with a simulated 429 once when the dev switch is on', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_URL, () => {
        calls++;
        return HttpResponse.json(EMPTY);
      }),
    );
    let simulate = true;
    const deps = noSleep();
    await runCostQuery(SUB, BODY, 'AT', {
      ...deps,
      takeSimulated429: () => {
        const s = simulate;
        simulate = false;
        return s;
      },
    });
    expect(deps.sleep).toHaveBeenCalledWith(5_000);
    expect(calls).toBe(1);
  });

  it('turns ARM errors into ArmError with status and code', async () => {
    server.use(
      http.post(QUERY_URL, () =>
        HttpResponse.json(
          {
            error: { code: 'RBACAccessDenied', message: 'The client does not have authorization' },
          },
          { status: 403 },
        ),
      ),
    );
    const err = await runCostQuery(SUB, BODY, 'AT', noSleep()).catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err).toMatchObject({ status: 403, code: 'RBACAccessDenied' });
  });

  it('refuses to POST anywhere except the Cost Management query endpoint', async () => {
    server.use(
      http.post(QUERY_URL, () =>
        HttpResponse.json({
          properties: {
            columns: [],
            rows: [],
            nextLink: `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg?api-version=1`,
          },
        }),
      ),
    );
    await expect(runCostQuery(SUB, BODY, 'AT', noSleep())).rejects.toThrow(
      'Refusing POST to non-query URL',
    );
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and HTTP dates, ignoring unrelated headers', () => {
    const h = new Headers({
      'retry-after': new Date(NOW + 30_000).toUTCString(),
      'x-ms-ratelimit-microsoft.costmanagement-client-retry-after': '12',
      'x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests': '999',
    });
    expect(retryAfterMs(h, NOW)).toBe(30_000);
  });

  it('returns null when no retry header is present', () => {
    expect(retryAfterMs(new Headers(), NOW)).toBeNull();
  });
});

describe('runCostQuery at resource-group scope', () => {
  it('runs at resource-group scope, still only on the query path', async () => {
    const urls: string[] = [];
    server.use(
      http.post(
        `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg-web_1/providers/Microsoft.CostManagement/query`,
        ({ request }) => {
          urls.push(request.url);
          return HttpResponse.json(EMPTY);
        },
      ),
    );
    await runCostQuery({ subscriptionId: SUB, resourceGroup: 'rg-web_1' }, BODY, 'AT', noSleep());
    expect(urls).toHaveLength(1);
  });

  it('refuses a resource group name that would change the path', async () => {
    for (const resourceGroup of ['..', '.']) {
      await expect(
        runCostQuery({ subscriptionId: SUB, resourceGroup }, BODY, 'AT', noSleep()),
      ).rejects.toThrow('Not a resource group name');
    }
  });
});
