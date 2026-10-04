import { type AuthConfig, LOGIN_HOST, SCOPES } from './config';

export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** `none` for silent sign-in. */
  prompt?: 'none' | 'select_account';
}

export function buildAuthorizeUrl(config: AuthConfig, params: AuthorizeParams): string {
  const url = new URL(
    `${LOGIN_HOST}/${encodeURIComponent(config.authority)}/oauth2/v2.0/authorize`,
  );
  const q = url.searchParams;
  q.set('client_id', config.clientId);
  q.set('response_type', 'code');
  q.set('redirect_uri', params.redirectUri);
  q.set('response_mode', 'query');
  q.set('scope', SCOPES.join(' '));
  q.set('state', params.state);
  q.set('code_challenge', params.codeChallenge);
  q.set('code_challenge_method', 'S256');
  if (params.prompt) q.set('prompt', params.prompt);
  return url.toString();
}

export type AuthorizeResult =
  | { ok: true; code: string }
  | { ok: false; error: string; description?: string };

/** Reads the code (or error) from the URL Entra redirected to. */
export function parseAuthorizeRedirect(
  redirectedTo: string,
  expectedState: string,
): AuthorizeResult {
  const q = new URL(redirectedTo).searchParams;
  if (q.get('state') !== expectedState) {
    return { ok: false, error: 'state_mismatch' };
  }
  const error = q.get('error');
  if (error) {
    return { ok: false, error, description: q.get('error_description') ?? undefined };
  }
  const code = q.get('code');
  if (!code) return { ok: false, error: 'missing_code' };
  return { ok: true, code };
}
