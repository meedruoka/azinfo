import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { server } from '@/tests/msw-server';
import {
  createAuthService,
  NotSignedInError,
  TenantSignInRequiredError,
  type WebAuthFlowDetails,
} from './auth-service';
import { DEFAULT_TENANT, sessionItem, signedInIntentItem } from './token-store';

const config = { clientId: 'client-123', authority: 'organizations' };
const REDIRECT = 'https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/';
const LOGIN = 'https://login.microsoftonline.com';
const TOKEN_URL = `${LOGIN}/:tenant/oauth2/v2.0/token`;
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/** A fake Entra that answers the authorize URL with a code (or an error). */
function fakeFlow(answer: { error?: string } = {}) {
  return vi.fn(async (details: WebAuthFlowDetails) => {
    const state = new URL(details.url).searchParams.get('state');
    return answer.error
      ? `${REDIRECT}?error=${answer.error}&state=${state}`
      : `${REDIRECT}?code=CODE&state=${state}`;
  });
}

const authorityOf = (details: WebAuthFlowDetails) => new URL(details.url).pathname.split('/')[1];

/** Token endpoint stub: records tenant and grant, answers per handler. */
function tokenEndpoint(
  answer: (call: {
    tenant: string;
    grant: string | null;
  }) => Response | Record<string, unknown> | Promise<Response>,
) {
  const calls: { tenant: string; grant: string | null }[] = [];
  server.use(
    http.post(TOKEN_URL, async ({ request, params }) => {
      const call = {
        tenant: String(params.tenant),
        grant: new URLSearchParams(await request.text()).get('grant_type'),
      };
      calls.push(call);
      const res = await answer(call);
      return res instanceof Response ? res : HttpResponse.json(res);
    }),
  );
  return calls;
}

const ok = (accessToken: string, refreshToken?: string) => ({
  access_token: accessToken,
  token_type: 'Bearer',
  expires_in: 3600,
  ...(refreshToken ? { refresh_token: refreshToken } : {}),
});

function service(launchWebAuthFlow = fakeFlow()) {
  return createAuthService({ config, redirectUri: REDIRECT, launchWebAuthFlow, now: () => NOW });
}

async function signedInSession(
  extra: Record<string, { accessToken: string; expiresAt: number }> = {},
) {
  await sessionItem.setValue({
    refreshToken: 'RT',
    access: { [DEFAULT_TENANT]: { accessToken: 'AT', expiresAt: NOW + HOUR }, ...extra },
  });
  await signedInIntentItem.setValue(true);
}

describe('auth service', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  describe('default tenant', () => {
    it('returns a fresh access token without any network call', async () => {
      await signedInSession();
      const flow = fakeFlow();
      expect(await service(flow).getAccessToken()).toBe('AT');
      expect(flow).not.toHaveBeenCalled();
    });

    it('refreshes a token about to expire and stores the rotated refresh token', async () => {
      await sessionItem.setValue({
        refreshToken: 'RT1',
        access: { [DEFAULT_TENANT]: { accessToken: 'OLD', expiresAt: NOW + 60_000 } },
      });
      const calls = tokenEndpoint(() => ok('NEW', 'RT2'));

      expect(await service().getAccessToken()).toBe('NEW');
      expect(calls).toEqual([{ tenant: 'organizations', grant: 'refresh_token' }]);
      expect(await sessionItem.getValue()).toEqual({
        refreshToken: 'RT2',
        access: { [DEFAULT_TENANT]: { accessToken: 'NEW', expiresAt: NOW + HOUR } },
      });
    });

    it('shares one refresh between concurrent callers', async () => {
      await sessionItem.setValue({ refreshToken: 'RT', access: {} });
      const calls = tokenEndpoint(() => ok('NEW'));
      const auth = service();
      const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
      expect([a, b]).toEqual(['NEW', 'NEW']);
      expect(calls).toHaveLength(1);
    });

    it('falls back to silent sign-in when the refresh token is rejected', async () => {
      await sessionItem.setValue({ refreshToken: 'DEAD', access: {} });
      await signedInIntentItem.setValue(true);
      tokenEndpoint(({ grant }) =>
        grant === 'refresh_token'
          ? HttpResponse.json({ error: 'invalid_grant' }, { status: 400 })
          : ok('SILENT'),
      );
      const flow = fakeFlow();

      expect(await service(flow).getAccessToken()).toBe('SILENT');
      expect(flow).toHaveBeenCalledTimes(1);
      expect(flow.mock.calls[0]?.[0]).toMatchObject({ interactive: false });
      expect(new URL(flow.mock.calls[0]?.[0].url ?? '').searchParams.get('prompt')).toBe('none');
    });

    it('does not sign in silently after an explicit sign-out', async () => {
      await signedInSession();
      const flow = fakeFlow();
      const auth = service(flow);
      await auth.signOut();

      await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NotSignedInError);
      expect(flow).not.toHaveBeenCalled();
      expect(await auth.isSignedIn()).toBe(false);
    });

    it('rethrows network-type refresh failures instead of discarding the session', async () => {
      await sessionItem.setValue({ refreshToken: 'RT', access: {} });
      tokenEndpoint(() => HttpResponse.json({ error: 'temporarily_unavailable' }, { status: 503 }));
      await expect(service().getAccessToken()).rejects.toMatchObject({
        code: 'temporarily_unavailable',
      });
      expect((await sessionItem.getValue())?.refreshToken).toBe('RT');
    });

    it('signIn tries silent first, then interactive', async () => {
      tokenEndpoint(() => ok('AT', 'RT'));
      let call = 0;
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        call++;
        const state = new URL(details.url).searchParams.get('state');
        return call === 1
          ? `${REDIRECT}?error=login_required&state=${state}`
          : `${REDIRECT}?code=CODE&state=${state}`;
      });

      await service(flow).signIn();

      expect(flow.mock.calls.map(([d]) => d.interactive)).toEqual([false, true]);
      expect(await sessionItem.getValue()).toEqual({
        refreshToken: 'RT',
        access: { [DEFAULT_TENANT]: { accessToken: 'AT', expiresAt: NOW + HOUR } },
      });
      expect(await signedInIntentItem.getValue()).toBe(true);
    });

    it("keeps Entra's error description from the redirect", async () => {
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get('state');
        return `${REDIRECT}?error=access_denied&error_description=${encodeURIComponent(
          'AADSTS65004: User declined to consent.\r\nTrace ID: x',
        )}&state=${state}`;
      });
      const err = await service(flow)
        .signIn()
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotSignedInError);
      expect(err.message).toBe(
        'Not signed in (access_denied): AADSTS65004: User declined to consent.',
      );
    });

    it('reports a cancelled interactive window as not signed in', async () => {
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        if (!details.interactive) {
          const state = new URL(details.url).searchParams.get('state');
          return `${REDIRECT}?error=login_required&state=${state}`;
        }
        throw new Error('The user did not approve access.');
      });
      const err = await service(flow)
        .signIn()
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotSignedInError);
      expect(err.reason).toBe('flow_cancelled');
      expect(err.message).toBe('Not signed in (flow_cancelled): The user did not approve access.');
      expect(await sessionItem.getValue()).toBeNull();
    });
  });

  describe('other tenants', () => {
    it('gets a token for another tenant silently with the shared refresh token', async () => {
      await signedInSession();
      const calls = tokenEndpoint(() => ok('AT-B', 'RT2'));
      const flow = fakeFlow();

      expect(await service(flow).getAccessToken(TENANT_B.toUpperCase())).toBe('AT-B');
      expect(calls).toEqual([{ tenant: TENANT_B, grant: 'refresh_token' }]);
      expect(flow).not.toHaveBeenCalled();
      const session = await sessionItem.getValue();
      expect(session?.refreshToken).toBe('RT2');
      expect(Object.keys(session?.access ?? {}).sort()).toEqual([DEFAULT_TENANT, TENANT_B].sort());
    });

    it('reuses the cached token for a tenant', async () => {
      await signedInSession({ [TENANT_B]: { accessToken: 'AT-B', expiresAt: NOW + HOUR } });
      const calls = tokenEndpoint(() => ok('NEVER'));
      expect(await service().getAccessToken(TENANT_B)).toBe('AT-B');
      expect(calls).toHaveLength(0);
    });

    it('tries prompt=none at the tenant when the refresh token is refused there', async () => {
      await signedInSession();
      tokenEndpoint(({ grant }) =>
        grant === 'refresh_token'
          ? HttpResponse.json({ error: 'invalid_grant', error_codes: [65001] }, { status: 400 })
          : ok('AT-B-SILENT'),
      );
      const flow = fakeFlow();

      expect(await service(flow).getAccessToken(TENANT_B)).toBe('AT-B-SILENT');
      expect(authorityOf(flow.mock.calls[0]?.[0] as WebAuthFlowDetails)).toBe(TENANT_B);
      // The home session survives a refusal by another tenant.
      expect((await sessionItem.getValue())?.access[DEFAULT_TENANT]?.accessToken).toBe('AT');
    });

    it('reports TenantSignInRequiredError when the tenant needs interaction', async () => {
      await signedInSession();
      tokenEndpoint(() =>
        HttpResponse.json({ error: 'interaction_required', error_codes: [50076] }, { status: 400 }),
      );
      const err = await service(fakeFlow({ error: 'interaction_required' }))
        .getAccessToken(TENANT_B)
        .catch((e) => e);
      expect(err).toBeInstanceOf(TenantSignInRequiredError);
      expect(err.tenantId).toBe(TENANT_B);
      expect(await service().isSignedIn()).toBe(true);
    });

    it('signInTenant signs in at that tenant and keeps the other tokens', async () => {
      await signedInSession();
      tokenEndpoint(() => ok('AT-B', 'RT-B'));
      let call = 0;
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        call++;
        const state = new URL(details.url).searchParams.get('state');
        return call === 1
          ? `${REDIRECT}?error=consent_required&state=${state}`
          : `${REDIRECT}?code=CODE&state=${state}`;
      });

      await service(flow).signInTenant(TENANT_B);

      expect(flow.mock.calls.map(([d]) => [authorityOf(d), d.interactive])).toEqual([
        [TENANT_B, false],
        [TENANT_B, true],
      ]);
      const session = await sessionItem.getValue();
      expect(session?.access[DEFAULT_TENANT]?.accessToken).toBe('AT');
      expect(session?.access[TENANT_B]?.accessToken).toBe('AT-B');
      expect(session?.refreshToken).toBe('RT-B');
    });

    it.each([
      ['admin approval refused', 'error=access_denied&error_description=AADSTS90094'],
      ['consent still required', 'error=consent_required'],
    ])('signInTenant: %s stays a tenant error and keeps the home session', async (_, query) => {
      await signedInSession();
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get('state');
        return `${REDIRECT}?${query}&state=${state}`;
      });

      const err = await service(flow)
        .signInTenant(TENANT_B)
        .catch((e) => e);

      expect(err).toBeInstanceOf(TenantSignInRequiredError);
      expect(err.tenantId).toBe(TENANT_B);
      expect(await service().isSignedIn()).toBe(true);
      expect((await sessionItem.getValue())?.access[DEFAULT_TENANT]?.accessToken).toBe('AT');
    });

    it('signInTenant: closing the window stays a tenant error', async () => {
      await signedInSession();
      const flow = vi.fn(async (details: WebAuthFlowDetails) => {
        if (!details.interactive) throw new Error('silent failed');
        throw new Error('The user did not approve access.');
      });

      const err = await service(flow)
        .signInTenant(TENANT_B)
        .catch((e) => e);

      expect(err).toBeInstanceOf(TenantSignInRequiredError);
      expect(err.detail).toBe('The user did not approve access.');
    });

    it('keeps every token when several tenants refresh at once', async () => {
      await signedInSession();
      const tenants = ['c1', 'c2', 'c3', 'c4'].map((t) => `${t}cccccc-0000-0000-0000-000000000000`);
      tokenEndpoint(({ tenant }) => ok(`AT-${tenant}`));
      const auth = service();
      await Promise.all(tenants.map((t) => auth.getAccessToken(t)));
      expect(Object.keys((await sessionItem.getValue())?.access ?? {}).sort()).toEqual(
        [DEFAULT_TENANT, ...tenants].sort(),
      );
    });

    it('does not bring tokens back when signed out during a refresh', async () => {
      await signedInSession({ [TENANT_B]: { accessToken: 'OLD', expiresAt: NOW - HOUR } });
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      tokenEndpoint(() => gate.then(() => HttpResponse.json(ok('AT-B', 'RT-NEW'))));
      const auth = service();
      const pending = auth.getAccessToken(TENANT_B).catch((e) => e);
      await new Promise((r) => setTimeout(r, 20)); // the refresh is now waiting on Entra
      await auth.signOut();
      release();

      expect(await pending).toBeInstanceOf(NotSignedInError);
      expect(await sessionItem.getValue()).toBeNull();
      expect(await signedInIntentItem.getValue()).toBe(false);
    });

    it('is not signed in to another tenant when signed out', async () => {
      const err = await service()
        .getAccessToken(TENANT_B)
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotSignedInError);
    });
  });
});
