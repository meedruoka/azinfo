import { accountHintFromIdToken, loginHintItem } from './account-hint';
import { buildAuthorizeUrl, parseAuthorizeRedirect } from './authorize';
import type { AuthConfig } from './config';
import { createPkcePair, randomUrlSafe } from './pkce';
import { redeemCode, refreshTokens, TokenError, type TokenSet } from './token-endpoint';
import {
  DEFAULT_TENANT,
  isAccessTokenFresh,
  sessionItem,
  signedInIntentItem,
  type TokenSession,
} from './token-store';

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
  /** `detail`: the browser's or Entra's own explanation, if any (never tokens). */
  constructor(
    readonly reason: string,
    readonly detail?: string,
  ) {
    super(`Not signed in (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'NotSignedInError';
  }
}

/**
 * Signed in, but this tenant can't issue a token silently: the app isn't
 * consented there yet, or the tenant demands MFA or a compliant device. One
 * interactive sign-in to that tenant fixes it; other tenants keep working.
 */
export class TenantSignInRequiredError extends Error {
  constructor(
    readonly tenantId: string,
    readonly detail?: string,
  ) {
    super(`Sign-in needed for tenant ${tenantId}${detail ? `: ${detail}` : ''}`);
    this.name = 'TenantSignInRequiredError';
  }
}

/** Errors meaning the refresh token can't be used here, so a new sign-in is needed. */
const REAUTH_ERRORS = new Set(['invalid_grant', 'interaction_required', 'consent_required']);

/**
 * Entra answers prompt=none with a redirect, sometimes via script, so the
 * silent flow waits for it instead of aborting on first page load.
 */
const SILENT_TIMEOUT_MS = 10_000;

const tenantKey = (tenantId?: string) => tenantId?.toLowerCase() ?? DEFAULT_TENANT;

export function createAuthService(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const inFlight = new Map<string, Promise<string>>();
  let sessionQueue: Promise<unknown> = Promise.resolve();
  /**
   * Bumped by sign-out. A refresh or sign-in that started before it must not
   * write tokens back afterwards, or signing out would not stick.
   */
  let generation = 0;

  /** Serialises read-modify-write of the session so parallel tenants don't clobber it. */
  function updateSession(
    change: (session: TokenSession | null) => TokenSession | null,
  ): Promise<void> {
    const next = sessionQueue.then(async () => {
      const updated = change(await sessionItem.getValue());
      if (updated) await sessionItem.setValue(updated);
      else await sessionItem.removeValue();
    });
    sessionQueue = next.catch(() => {});
    return next;
  }

  /**
   * Stores a token for `key` and keeps the newest refresh token (Entra rotates
   * them). If the user signed out since `startedIn`, drops it and throws.
   */
  async function storeTokens(key: string, tokens: TokenSet, startedIn: number): Promise<void> {
    await updateSession((s) => {
      if (startedIn !== generation) return s;
      return {
        refreshToken: tokens.refreshToken ?? s?.refreshToken,
        access: {
          ...s?.access,
          [key]: { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
        },
      };
    });
    if (startedIn !== generation) throw new NotSignedInError('signed_out');
    // Remember which account this is, for silent sign-ins later (0.1.3).
    const hint = accountHintFromIdToken(tokens.idToken);
    if (hint) await loginHintItem.setValue(hint);
  }

  function authorityFor(key: string): AuthConfig {
    return key === DEFAULT_TENANT ? deps.config : { ...deps.config, authority: key };
  }

  async function runAuthorizeFlow(key: string, interactive: boolean): Promise<TokenSet> {
    const startedIn = generation;
    const config = authorityFor(key);
    const { verifier, challenge } = await createPkcePair();
    const state = randomUrlSafe(16);
    const url = buildAuthorizeUrl(config, {
      redirectUri: deps.redirectUri,
      state,
      codeChallenge: challenge,
      prompt: interactive ? undefined : 'none',
      // Silent only: the interactive window keeps its account picker, so the
      // user can still choose another account.
      loginHint: interactive ? undefined : ((await loginHintItem.getValue()) ?? undefined),
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
    } catch (e) {
      // Window closed by the user, the sign-in page failed to load (e.g. an
      // unknown tenant makes Entra answer with an error page, so no window
      // opens), or the silent flow could not finish. Keep the browser's text.
      throw new NotSignedInError(
        interactive ? 'flow_cancelled' : 'silent_failed',
        e instanceof Error ? e.message : String(e),
      );
    }
    if (!redirectedTo) throw new NotSignedInError('no_redirect');

    const result = parseAuthorizeRedirect(redirectedTo, state);
    if (!result.ok) {
      throw new NotSignedInError(result.error, result.description?.split(/\r?\n/)[0]);
    }

    const tokens = await redeemCode(config, result.code, verifier, deps.redirectUri, now());
    await storeTokens(key, tokens, startedIn);
    await signedInIntentItem.setValue(true);
    return tokens;
  }

  /** Silent first; interactive only if silent fails. */
  async function signInTo(key: string): Promise<void> {
    try {
      await runAuthorizeFlow(key, false);
    } catch (e) {
      if (!(e instanceof NotSignedInError)) throw e;
      await runAuthorizeFlow(key, true);
    }
  }

  async function acquire(key: string): Promise<string> {
    const startedIn = generation;
    const session = await sessionItem.getValue();
    const isDefault = key === DEFAULT_TENANT;

    if (session?.refreshToken) {
      try {
        const tokens = await refreshTokens(authorityFor(key), session.refreshToken, now());
        await storeTokens(key, tokens, startedIn);
        return tokens.accessToken;
      } catch (e) {
        if (!(e instanceof TokenError && REAUTH_ERRORS.has(e.code))) throw e;
        // The refresh token is dead for the home sign-in, but may only be
        // refused by another tenant (no consent there, MFA): keep it then.
        if (isDefault) await updateSession(() => null);
      }
    }

    if (isDefault) {
      if (!(await signedInIntentItem.getValue())) throw new NotSignedInError('signed_out');
      return (await runAuthorizeFlow(key, false)).accessToken;
    }

    // Another tenant: only meaningful once signed in at all.
    if (!session && !(await signedInIntentItem.getValue())) {
      throw new NotSignedInError('signed_out');
    }
    try {
      return (await runAuthorizeFlow(key, false)).accessToken;
    } catch (e) {
      if (e instanceof NotSignedInError && e.reason !== 'signed_out') {
        throw new TenantSignInRequiredError(key, e.detail);
      }
      throw e;
    }
  }

  return {
    /**
     * A valid ARM access token for `tenantId`, or for the configured authority
     * when omitted. Refreshes or re-authenticates silently if needed.
     */
    async getAccessToken(tenantId?: string): Promise<string> {
      const key = tenantKey(tenantId);
      const token = (await sessionItem.getValue())?.access[key];
      if (token && isAccessTokenFresh(token, now())) return token.accessToken;
      // Popup and panel may ask at the same time; share one refresh per tenant.
      let pending = inFlight.get(key);
      if (!pending) {
        const started = acquire(key).finally(() => {
          // Sign-out may have replaced the entry; only remove our own.
          if (inFlight.get(key) === started) inFlight.delete(key);
        });
        pending = started;
        inFlight.set(key, pending);
      }
      return pending;
    },

    /** Sign in through the configured authority. */
    signIn(): Promise<void> {
      return signInTo(DEFAULT_TENANT);
    },

    /**
     * Sign in to one more tenant (consent, MFA or device checks there). A refusal
     * there (admin approval required, window closed) only concerns that tenant:
     * it stays a TenantSignInRequiredError, never "not signed in" for everything.
     */
    async signInTenant(tenantId: string): Promise<void> {
      const key = tenantKey(tenantId);
      try {
        await signInTo(key);
      } catch (e) {
        if (e instanceof NotSignedInError && e.reason !== 'signed_out') {
          throw new TenantSignInRequiredError(key, e.detail ?? e.reason);
        }
        throw e;
      }
    },

    async signOut(): Promise<void> {
      generation++;
      // Later callers must not join a refresh that started before sign-out.
      inFlight.clear();
      await updateSession(() => null);
      await signedInIntentItem.setValue(false);
      await loginHintItem.removeValue();
    },

    async isSignedIn(): Promise<boolean> {
      const session = await sessionItem.getValue();
      return !!session && (!!session.refreshToken || !!session.access[DEFAULT_TENANT]);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
