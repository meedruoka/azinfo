import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { server } from '@/tests/msw-server';
import { TenantSignInRequiredError } from '../auth/auth-service';
import { createDirectoryService, matchTenant } from './directory';
import { listTenants } from './tenants';

const TENANTS_URL = 'https://management.azure.com/tenants';
const SUBS_URL = 'https://management.azure.com/subscriptions';
const HOME = 'aaaaaaaa-0000-0000-0000-000000000000';
const GUEST = 'bbbbbbbb-0000-0000-0000-000000000000';
const LOCKED = 'cccccccc-0000-0000-0000-000000000000';
const CUSTOMER = 'dddddddd-0000-0000-0000-000000000000';
const HOUR = 3_600_000;

const tenant = (id: string, name: string, domain: string, category = 'Home') => ({
  id: `/tenants/${id}`,
  tenantId: id.toUpperCase(),
  displayName: name,
  defaultDomain: domain,
  domains: [domain, `${name.toLowerCase()}.example.com`],
  tenantCategory: category,
});
const sub = (id: string, name: string) => ({
  id: `/subscriptions/${id}`,
  subscriptionId: id,
  displayName: name,
  state: 'Enabled',
  tenantId: 'irrelevant',
});
const SUB_HOME = '11111111-0000-0000-0000-000000000000';
const SUB_GUEST = '22222222-0000-0000-0000-000000000000';
const SUB_SHARED = '33333333-0000-0000-0000-000000000000';

function azure(
  tenantsListed = [
    tenant(HOME, 'Home', 'home.onmicrosoft.com'),
    tenant(GUEST, 'Guest', 'guest.onmicrosoft.com'),
    tenant(LOCKED, 'Locked', 'locked.onmicrosoft.com'),
    tenant(CUSTOMER, 'Customer', 'customer.onmicrosoft.com', 'ProjectedBy'),
  ],
) {
  const calls: string[] = [];
  server.use(
    http.get(TENANTS_URL, ({ request }) => {
      calls.push(`tenants:${request.headers.get('authorization')}`);
      return HttpResponse.json({ value: tenantsListed });
    }),
    http.get(SUBS_URL, ({ request }) => {
      const token = request.headers.get('authorization');
      calls.push(`subs:${token}`);
      if (token === `Bearer AT-${HOME}`) {
        return HttpResponse.json({ value: [sub(SUB_HOME, 'Home sub'), sub(SUB_SHARED, 'Shared')] });
      }
      if (token === `Bearer AT-${GUEST}`) {
        return HttpResponse.json({
          value: [sub(SUB_GUEST, 'Guest sub'), sub(SUB_SHARED, 'Shared')],
        });
      }
      return HttpResponse.json({ value: [] });
    }),
  );
  return calls;
}

function service(now = () => 1_700_000_000_000) {
  const tokenRequests: (string | undefined)[] = [];
  const directory = createDirectoryService({
    getAccessToken: async (tenantId) => {
      tokenRequests.push(tenantId);
      if (tenantId === LOCKED) throw new TenantSignInRequiredError(LOCKED, 'AADSTS50076');
      return `AT-${tenantId ?? 'default'}`;
    },
    ttlMs: () => 4 * HOUR,
    now,
  });
  return { directory, tokenRequests };
}

describe('listTenants', () => {
  it('lowercases IDs and domains and merges the default domain', async () => {
    azure();
    const [home] = await listTenants('AT');
    expect(home).toEqual({
      tenantId: HOME,
      displayName: 'Home',
      domains: ['home.onmicrosoft.com', 'home.example.com'],
      category: 'Home',
    });
  });
});

describe('directory', () => {
  beforeEach(() => fakeBrowser.reset());

  it('lists subscriptions per member tenant with that tenant as access tenant', async () => {
    azure();
    const { directory, tokenRequests } = service();
    const dir = await directory.get();

    expect(dir.tenants.map((t) => t.tenantId)).toEqual([HOME, GUEST, LOCKED]);
    expect(dir.subscriptions.map((s) => [s.displayName, s.accessTenantId])).toEqual([
      ['Home sub', HOME],
      ['Shared', HOME],
      ['Guest sub', GUEST],
    ]);
    expect(dir.needsSignIn).toEqual([LOCKED]);
    expect(dir.failed).toEqual([]);
    // Lighthouse "ProjectedBy" tenants never get a token request.
    expect(tokenRequests).not.toContain(CUSTOMER);
  });

  it('serves the cached directory within the TTL', async () => {
    const calls = azure();
    const { directory } = service();
    await directory.get();
    const before = calls.length;
    await directory.get();
    expect(calls.length).toBe(before);
    await directory.get(true);
    expect(calls.length).toBeGreaterThan(before);
  });

  it('records other failures per tenant without failing the rest', async () => {
    azure();
    const directory = createDirectoryService({
      getAccessToken: async (tenantId) => {
        if (tenantId === GUEST) throw new Error('network down');
        if (tenantId === LOCKED) throw new TenantSignInRequiredError(LOCKED);
        return `AT-${tenantId ?? 'default'}`;
      },
      ttlMs: () => HOUR,
    });
    const dir = await directory.get();
    expect(dir.failed).toEqual([{ tenantId: GUEST, message: 'network down' }]);
    expect(dir.subscriptions.map((s) => s.displayName)).toEqual(['Home sub', 'Shared']);
  });

  it('resolves the tenant for a subscription, then by portal hint', async () => {
    azure();
    const { directory } = service();
    expect(await directory.tenantForSubscription(SUB_GUEST.toUpperCase())).toBe(GUEST);
    expect(
      await directory.tenantForSubscription(
        '99999999-0000-0000-0000-000000000000',
        'GUEST.example.com',
      ),
    ).toBe(GUEST);
    expect(
      await directory.tenantForSubscription('99999999-0000-0000-0000-000000000000', 'unknown.com'),
    ).toBeUndefined();
    expect(
      await directory.tenantForSubscription('99999999-0000-0000-0000-000000000000'),
    ).toBeUndefined();
  });

  it('does not cache a build that finishes after clear()', async () => {
    azure();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const directory = createDirectoryService({
      getAccessToken: async (tenantId) => {
        await gate;
        return `AT-${tenantId ?? 'default'}`;
      },
      ttlMs: () => HOUR,
    });
    const pending = directory.get();
    await directory.clear();
    release();
    await pending;
    expect(Object.keys(await fakeBrowser.storage.local.get())).not.toContain('directory.v1.all');
  });

  it('clear() forces a rebuild', async () => {
    const calls = azure();
    const { directory } = service();
    await directory.get();
    const before = calls.length;
    await directory.clear();
    await directory.get();
    expect(calls.length).toBeGreaterThan(before);
  });
});

describe('matchTenant', () => {
  const tenants = [
    { tenantId: HOME, displayName: 'Home', domains: ['home.onmicrosoft.com'], category: 'Home' },
  ];
  it('matches by ID or domain, case-insensitively', () => {
    expect(matchTenant(tenants, HOME.toUpperCase())?.tenantId).toBe(HOME);
    expect(matchTenant(tenants, ' Home.OnMicrosoft.com ')?.tenantId).toBe(HOME);
    expect(matchTenant(tenants, 'other.com')).toBeUndefined();
    expect(matchTenant(tenants, undefined)).toBeUndefined();
  });
});
