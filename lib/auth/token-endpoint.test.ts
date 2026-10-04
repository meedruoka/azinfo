import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/tests/msw-server';
import { redeemCode, refreshTokens, TokenError } from './token-endpoint';

const config = { clientId: 'client-123', authority: 'organizations' };
const TOKEN_URL = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token';
const NOW = 1_700_000_000_000;

describe('token endpoint', () => {
  it('redeems a code with PKCE and returns an absolute expiry', async () => {
    let sent: URLSearchParams | undefined;
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        sent = new URLSearchParams(await request.text());
        return HttpResponse.json({
          access_token: 'AT',
          token_type: 'Bearer',
          expires_in: 3599,
          refresh_token: 'RT',
        });
      }),
    );

    const tokens = await redeemCode(config, 'the-code', 'the-verifier', 'https://x/', NOW);

    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW + 3_599_000 });
    expect(Object.fromEntries(sent ?? [])).toMatchObject({
      client_id: 'client-123',
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'https://x/',
    });
    expect(sent?.has('client_secret')).toBe(false);
  });

  it('accepts expires_in sent as a string', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'AT', token_type: 'Bearer', expires_in: '3600' }),
      ),
    );
    const tokens = await refreshTokens(config, 'RT', NOW);
    expect(tokens.expiresAt).toBe(NOW + 3_600_000);
    expect(tokens.refreshToken).toBeUndefined();
  });

  it('turns Entra errors into TokenError with the first line of the description', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: 'invalid_request',
            error_description:
              'AADSTS9002326: Cross-origin token redemption is permitted only for the Single-Page Application client-type.\r\nTrace ID: 123',
            error_codes: [9002326],
          },
          { status: 400 },
        ),
      ),
    );

    const err = await refreshTokens(config, 'SECRET-REFRESH-TOKEN', NOW).catch((e) => e);
    expect(err).toBeInstanceOf(TokenError);
    expect(err.code).toBe('invalid_request');
    expect(err.aadstsCodes).toEqual([9002326]);
    expect(err.message).toBe(
      'invalid_request: AADSTS9002326: Cross-origin token redemption is permitted only for the Single-Page Application client-type.',
    );
    expect(err.message).not.toContain('SECRET-REFRESH-TOKEN');
  });

  it('handles a non-JSON error body', async () => {
    server.use(http.post(TOKEN_URL, () => new HttpResponse('Bad gateway', { status: 502 })));
    const err = await refreshTokens(config, 'RT', NOW).catch((e) => e);
    expect(err).toMatchObject({
      code: 'http_error',
      message: 'http_error: Token endpoint returned HTTP 502',
    });
  });

  it('rejects a success response without an access token', async () => {
    server.use(http.post(TOKEN_URL, () => HttpResponse.json({ token_type: 'Bearer' })));
    const err = await refreshTokens(config, 'RT', NOW).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid_response' });
  });
});
