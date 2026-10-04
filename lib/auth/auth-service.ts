import { buildAuthorizeUrl, parseAuthorizeRedirect } from './authorize';
import type { AuthConfig } from './config';
import { createPkcePair, randomUrlSafe } from './pkce';
import { redeemCode, refreshTokens, TokenError, type TokenSet } from './token-endpoint';
import { isAccessTokenFresh, signedInIntentItem, tokenItem } from './token-store';

export interface WebAuthFlowDetails {
  url: string;
  interactive: boolean;
  abortOnLoadForNonInteractive?: boolean;
  timeoutMsForNonInteractive?: number;
}

export interface AuthDeps {
  config: AuthConfig;
  /** From chrome.identity.getRedirectURL(); differs per store build. */
  redirectUri: string;
  launchWebAuthFlow: (details: WebAuthFlowDetails) => Promise<string | undefined>;
  now?: () => number;
}

/** No usable session: the user must click Sign in. */
export class NotSignedInError extends Error {
  constructor(readonly reason: string) {
    super(`Not signed in (${reason})`);
    this.name = 'NotSignedInError';
  }
}

/** Errors meaning the refresh token is unusable, so a new sign-in is needed. */
const REAUTH_ERRORS = new Set(['invalid_grant', 'interaction_required', 'consent_required']);

/**
 * Entra answers prompt=none with a redirect, sometimes via script, so the
 * silent flow waits for it instead of aborting on first page load.
 */
const SILENT_TIMEOUT_MS = 10_000;

export function createAuthService(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  let refreshInFlight: Promise<string> | null = null;

  async function runAuthorizeFlow(interactive: boolean): Promise<TokenSet> {
    const { verifier, challenge } = await createPkcePair();
    const state = randomUrlSafe(16);
    const url = buildAuthorizeUrl(deps.config, {
      redirectUri: deps.redirectUri,
      state,
      codeChallenge: challenge,
      prompt: interactive ? undefined : 'none',
    });

    let redirectedTo: string | undefined;
    try {
      redirectedTo = await deps.launchWebAuthFlow(
        interactive
          ? { url, interactive: true }
          : {
              url,
              interactive: false,
              abortOnLoadForNonInteractive: false,
              timeoutMsForNonInteractive: SILENT_TIMEOUT_MS,
            },
      );
    } catch {
      // Window closed by the user, or the silent flow could not finish.
      throw new NotSignedInError(interactive ? 'flow_cancelled' : 'silent_failed');
    }
    if (!redirectedTo) throw new NotSignedInError('no_redirect');

    const result = parseAuthorizeRedirect(redirectedTo, state);
    if (!result.ok) throw new NotSignedInError(result.error);

    const tokens = await redeemCode(deps.config, result.code, verifier, deps.redirectUri, now());
    await tokenItem.setValue(tokens);
    await signedInIntentItem.setValue(true);
    return tokens;
  }

  async function refreshOrReauthenticate(): Promise<string> {
    const tokens = await tokenItem.getValue();
    if (tokens?.refreshToken) {
      try {
        const next = await refreshTokens(deps.config, tokens.refreshToken, now());
        // Entra rotates refresh tokens; keep the old one only if none came back.
        const merged = { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
        await tokenItem.setValue(merged);
        return merged.accessToken;
      } catch (e) {
        if (!(e instanceof TokenError && REAUTH_ERRORS.has(e.code))) throw e;
        await tokenItem.removeValue();
      }
    }
    if (!(await signedInIntentItem.getValue())) throw new NotSignedInError('signed_out');
    return (await runAuthorizeFlow(false)).accessToken;
  }

  return {
    /** A valid ARM access token, refreshing or re-authenticating silently if needed. */
    async getAccessToken(): Promise<string> {
      const tokens = await tokenItem.getValue();
      if (tokens && isAccessTokenFresh(tokens, now())) return tokens.accessToken;
      // Popup and panel may ask at the same time; share one refresh.
      refreshInFlight ??= refreshOrReauthenticate().finally(() => {
        refreshInFlight = null;
      });
      return refreshInFlight;
    },

    /** Silent first; interactive only if silent fails. */
    async signIn(): Promise<void> {
      try {
        await runAuthorizeFlow(false);
      } catch (e) {
        if (!(e instanceof NotSignedInError)) throw e;
        await runAuthorizeFlow(true);
      }
    },

    async signOut(): Promise<void> {
      await tokenItem.removeValue();
      await signedInIntentItem.setValue(false);
    },

    async isSignedIn(): Promise<boolean> {
      return (await tokenItem.getValue()) !== null;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
