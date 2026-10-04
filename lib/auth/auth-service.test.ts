import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { server } from '@/tests/msw-server';
import { createAuthService, NotSignedInError, type WebAuthFlowDetails } from './auth-service';
import { signedInIntentItem, tokenItem } from './token-store';

const config = { clientId: 'client-123', authority: 'organizations' };
const REDIRECT = 'https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/';
const TOKEN_URL = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token';
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

function tokenHandler(body: Record<string, unknown>, status = 200) {
  return http.post(TOKEN_URL, () => HttpResponse.json(body, { status }));
}

function service(launchWebAuthFlow = fakeFlow()) {
  return createAuthService({ config, redirectUri: REDIRECT, launchWebAuthFlow, now: () => NOW });
}

describe('auth service', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns a fresh access token without any network call', async () => {
    await tokenItem.setValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW + HOUR });
    const flow = fakeFlow();
    expect(await service(flow).getAccessToken()).toBe('AT');
    expect(flow).not.toHaveBeenCalled();
  });

  it('refreshes a token that expires within the skew window and stores the rotated refresh token', async () => {
    await tokenItem.setValue({ accessToken: 'OLD', refreshToken: 'RT1', expiresAt: NOW + 60_000 });
    server.use(
      tokenHandler({
        access_token: 'NEW',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'RT2',
      }),
    );

    expect(await service().getAccessToken()).toBe('NEW');
    expect(await tokenItem.getValue()).toEqual({
      accessToken: 'NEW',
      refreshToken: 'RT2',
      expiresAt: NOW + HOUR,
    });
  });

  it('shares one refresh between concurrent callers', async () => {
    await tokenItem.setValue({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: NOW - 1 });
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, () => {
        calls++;
        return HttpResponse.json({ access_token: 'NEW', token_type: 'Bearer', expires_in: 3600 });
      }),
    );
    const auth = service();
    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect([a, b]).toEqual(['NEW', 'NEW']);
    expect(calls).toBe(1);
  });

  it('falls back to silent sign-in when the refresh token is rejected', async () => {
    await tokenItem.setValue({ accessToken: 'OLD', refreshToken: 'DEAD', expiresAt: NOW - 1 });
    await signedInIntentItem.setValue(true);
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const grant = new URLSearchParams(await request.text()).get('grant_type');
        return grant === 'refresh_token'
          ? HttpResponse.json({ error: 'invalid_grant' }, { status: 400 })
          : HttpResponse.json({ access_token: 'SILENT', token_type: 'Bearer', expires_in: 3600 });
      }),
    );
    const flow = fakeFlow();

    expect(await service(flow).getAccessToken()).toBe('SILENT');
    expect(flow).toHaveBeenCalledTimes(1);
    expect(flow.mock.calls[0]?.[0]).toMatchObject({ interactive: false });
    expect(new URL(flow.mock.calls[0]?.[0].url ?? '').searchParams.get('prompt')).toBe('none');
  });

  it('does not sign in silently after an explicit sign-out', async () => {
    await tokenItem.setValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW + HOUR });
    const flow = fakeFlow();
    const auth = service(flow);
    await auth.signOut();

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NotSignedInError);
    expect(flow).not.toHaveBeenCalled();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it('rethrows network-type refresh failures instead of discarding the session', async () => {
    await tokenItem.setValue({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: NOW - 1 });
    server.use(tokenHandler({ error: 'temporarily_unavailable' }, 503));
    await expect(service().getAccessToken()).rejects.toMatchObject({
      code: 'temporarily_unavailable',
    });
    expect((await tokenItem.getValue())?.refreshToken).toBe('RT');
  });

  it('signIn tries silent first, then interactive', async () => {
    server.use(
      tokenHandler({
        access_token: 'AT',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'RT',
      }),
    );
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
    expect(await tokenItem.getValue()).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' });
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
    expect(await tokenItem.getValue()).toBeNull();
  });
});
