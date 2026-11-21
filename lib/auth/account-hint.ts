import { storage } from 'wxt/utils/storage';

/**
 * Which Microsoft account signed in, sent as `login_hint` on silent sign-ins.
 * Without it, Entra refuses `prompt=none` when the browser is signed in to
 * several accounts (AADSTS16000), so a restart signed the user out
 * (decision 006, 0.1.3).
 *
 * Kept in local storage so it survives a browser restart; removed on sign-out.
 * It is the ID token's opaque `login_hint` claim when the app registration
 * issues it, else the sign-in name. It's sent only to Microsoft.
 */
export const loginHintItem = storage.defineItem<string | null>('local:auth.loginHint', {
  fallback: null,
});

/** Claims tried in order: the opaque hint Microsoft recommends, then the sign-in name. */
const HINT_CLAIMS = ['login_hint', 'preferred_username', 'upn', 'email'] as const;

/**
 * The account hint in an ID token, or undefined. The token's signature isn't
 * checked: it came straight from Microsoft's token endpoint over HTTPS, and
 * the value is only a hint that Microsoft itself checks again.
 */
export function accountHintFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(base64UrlDecode(payload));
  } catch {
    return undefined;
  }
  for (const name of HINT_CLAIMS) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim() && value.length <= 512) return value.trim();
  }
  return undefined;
}

function base64UrlDecode(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
