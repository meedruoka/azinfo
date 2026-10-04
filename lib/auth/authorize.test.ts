import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, parseAuthorizeRedirect } from './authorize';

const config = { clientId: 'client-123', authority: 'contoso.onmicrosoft.com' };
const REDIRECT = 'https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/';

describe('buildAuthorizeUrl', () => {
  it('builds a PKCE authorization-code request', () => {
    const url = new URL(
      buildAuthorizeUrl(config, { redirectUri: REDIRECT, state: 's1', codeChallenge: 'c1' }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-123',
      response_type: 'code',
      redirect_uri: REDIRECT,
      response_mode: 'query',
      scope: 'https://management.azure.com/user_impersonation openid profile offline_access',
      state: 's1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    });
  });

  it('adds prompt=none for silent sign-in', () => {
    const url = new URL(
      buildAuthorizeUrl(config, {
        redirectUri: REDIRECT,
        state: 's',
        codeChallenge: 'c',
        prompt: 'none',
      }),
    );
    expect(url.searchParams.get('prompt')).toBe('none');
  });
});

describe('parseAuthorizeRedirect', () => {
  it('returns the code when state matches', () => {
    expect(parseAuthorizeRedirect(`${REDIRECT}?code=abc&state=s1`, 's1')).toEqual({
      ok: true,
      code: 'abc',
    });
  });

  it('rejects a state mismatch even if a code is present', () => {
    expect(parseAuthorizeRedirect(`${REDIRECT}?code=abc&state=evil`, 's1')).toEqual({
      ok: false,
      error: 'state_mismatch',
    });
  });

  it('returns Entra errors such as login_required from silent sign-in', () => {
    expect(
      parseAuthorizeRedirect(
        `${REDIRECT}?error=login_required&error_description=No+session&state=s1`,
        's1',
      ),
    ).toEqual({ ok: false, error: 'login_required', description: 'No session' });
  });

  it('reports a missing code', () => {
    expect(parseAuthorizeRedirect(`${REDIRECT}?state=s1`, 's1')).toEqual({
      ok: false,
      error: 'missing_code',
    });
  });
});
