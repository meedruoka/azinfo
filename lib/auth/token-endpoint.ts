import { z } from 'zod';
import { type AuthConfig, LOGIN_HOST, SCOPES } from './config';

const TokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.coerce.number().positive(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
});

const TokenErrorResponse = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  error_codes: z.array(z.number()).optional(),
});

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

/**
 * Token endpoint failure. Carries Entra's error code and description only;
 * never a token or the request body.
 */
export class TokenError extends Error {
  constructor(
    readonly code: string,
    readonly description?: string,
    readonly aadstsCodes: number[] = [],
  ) {
    super(description ? `${code}: ${firstLine(description)}` : code);
    this.name = 'TokenError';
  }
}

export function redeemCode(
  config: AuthConfig,
  code: string,
  verifier: string,
  redirectUri: string,
  now = Date.now(),
): Promise<TokenSet> {
  return postToken(
    config,
    {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    },
    now,
  );
}

export function refreshTokens(
  config: AuthConfig,
  refreshToken: string,
  now = Date.now(),
): Promise<TokenSet> {
  return postToken(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, now);
}

async function postToken(
  config: AuthConfig,
  fields: Record<string, string>,
  now: number,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: SCOPES.join(' '),
    ...fields,
  });
  const res = await fetch(
    `${LOGIN_HOST}/${encodeURIComponent(config.authority)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = TokenErrorResponse.safeParse(json);
    if (err.success) {
      throw new TokenError(err.data.error, err.data.error_description, err.data.error_codes);
    }
    throw new TokenError('http_error', `Token endpoint returned HTTP ${res.status}`);
  }

  const ok = TokenResponse.safeParse(json);
  if (!ok.success) throw new TokenError('invalid_response', 'Unexpected token response shape');
  return {
    accessToken: ok.data.access_token,
    refreshToken: ok.data.refresh_token,
    expiresAt: now + ok.data.expires_in * 1000,
  };
}

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0] ?? s;
}
