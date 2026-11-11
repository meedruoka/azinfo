import { storage } from 'wxt/utils/storage';

export interface AccessToken {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

/** Key for the token of the configured authority (the "sign in through" tenant). */
export const DEFAULT_TENANT = 'default';

export interface TokenSession {
  /**
   * Latest refresh token. Entra binds it to the user and client, not to a
   * tenant, so it can request tokens for any tenant the user belongs to.
   */
  refreshToken?: string;
  /** ARM access token per tenant: {@link DEFAULT_TENANT}, else a lowercase tenant ID. */
  access: Record<string, AccessToken>;
}

/**
 * Tokens live in chrome.storage.session only: in memory, cleared when the
 * browser closes or the extension updates, and not readable by content
 * scripts at the default access level.
 */
export const sessionItem = storage.defineItem<TokenSession>('session:auth.v2');

/**
 * Whether the user wants to be signed in. Lets the worker sign in silently
 * after a browser restart, and stops it doing so after an explicit sign-out.
 * Contains no token or account data.
 */
export const signedInIntentItem = storage.defineItem<boolean>('local:auth.signedInIntent', {
  fallback: false,
});

/** Refresh this long before expiry so a token never expires mid-request. */
export const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export function isAccessTokenFresh(token: { expiresAt: number }, now = Date.now()): boolean {
  return token.expiresAt - EXPIRY_SKEW_MS > now;
}
