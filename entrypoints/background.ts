import { type AuthService, createAuthService, NotSignedInError } from '@/lib/auth/auth-service';
import { readAuthConfig } from '@/lib/auth/config';
import { TokenError } from '@/lib/auth/token-endpoint';
import { ArmError } from '@/lib/azure/arm-client';
import { listSubscriptions } from '@/lib/azure/subscriptions';
import type { ErrorKind, Request, ResponseMap, Result } from '@/lib/messages';

// Service worker: owns auth, Azure API calls and (later) the cache.
// It is the only network-facing part of the extension.
export default defineBackground(() => {
  let authService: AuthService | undefined;
  // Created on first use so a missing client ID surfaces as a popup error
  // instead of a crashed worker.
  const getAuth = () =>
    (authService ??= createAuthService({
      config: readAuthConfig(),
      redirectUri: browser.identity.getRedirectURL(),
      launchWebAuthFlow: (details) => browser.identity.launchWebAuthFlow(details),
    }));

  async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
    const auth = getAuth();
    switch (request.type) {
      case 'getAuthState':
        if (await auth.isSignedIn()) return { signedIn: true };
        // Session storage is empty after a browser restart: try a silent
        // sign-in, unless the user explicitly signed out.
        try {
          await auth.getAccessToken();
          return { signedIn: true };
        } catch (e) {
          if (e instanceof NotSignedInError) return { signedIn: false };
          throw e;
        }
      case 'signIn':
        await auth.signIn();
        return { signedIn: true };
      case 'signOut':
        await auth.signOut();
        return { signedIn: false };
      case 'listSubscriptions':
        return listSubscriptions(await auth.getAccessToken());
    }
  }

  browser.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
    handle(request)
      .then((data) => sendResponse({ ok: true, data } satisfies Result<unknown>))
      .catch((e: unknown) => sendResponse(toErrorResult(e)));
    return true; // Keep the channel open for the async response.
  });
});

function toErrorResult(e: unknown): Result<never> {
  const kind: ErrorKind =
    e instanceof NotSignedInError
      ? 'notSignedIn'
      : e instanceof TokenError
        ? 'auth'
        : e instanceof ArmError
          ? 'azure'
          : 'unknown';
  // Error messages never contain tokens (see TokenError / ArmError).
  const message = e instanceof Error ? e.message : String(e);
  console.warn('[azinfo]', kind, message);
  return { ok: false, kind, message };
}
