import { storage } from 'wxt/utils/storage';
import type { TokenSet } from './token-endpoint';

/**
 * Tokens live in chrome.storage.session only: in memory, cleared when the
 * browser closes, and not readable by content scripts at the default access
 * level.
 */
export const tokenItem = storage.defineItem<TokenSet>('session:auth.tokens');

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

export function isAccessTokenFresh(tokens: TokenSet, now = Date.now()): boolean {
  return tokens.expiresAt - EXPIRY_SKEW_MS > now;
}
