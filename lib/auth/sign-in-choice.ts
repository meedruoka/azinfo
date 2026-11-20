import { storage } from 'wxt/utils/storage';
import { normaliseAuthority } from '../settings';

/**
 * Personal Microsoft accounts can't sign in through `organizations`: they
 * must use their own tenant (decision 006). These remember which tenant the
 * user chose, and which tenant the portal last showed.
 */

/**
 * Tenant of the last personal-account sign-in, so the silent sign-in after a
 * browser restart uses it too. Null for work accounts. A tenant domain or ID,
 * no account data. Removed on sign-out and when the options-page tenant changes.
 */
export const signInAuthorityItem = storage.defineItem<string | null>('local:auth.signInAuthority', {
  fallback: null,
});

/**
 * Last tenant seen in a portal address (`#@<tenant>`), offered to personal
 * accounts in the popup. In memory only: cleared when the browser closes.
 */
export const lastPortalTenantItem = storage.defineItem<string | null>('session:portal.lastTenant', {
  fallback: null,
});

/**
 * The tenant a personal account signs in through, normalised, or null when
 * it isn't one: `organizations` and `common` don't work for personal accounts.
 */
export function personalTenant(input: string): string | null {
  const value = normaliseAuthority(input);
  return value === null || value === 'organizations' || value === 'common' ? null : value;
}

/** What a home sign-in should do with the remembered personal tenant. */
export type SignInPlan =
  /** Keep the current authority. */
  | { kind: 'keep' }
  /** Sign the old session out, then remember `tenant` (null: forget it). */
  | { kind: 'switch'; tenant: string | null }
  | { kind: 'invalid'; input: string };

/**
 * `setting`: the options-page tenant, which always wins. `remembered`: the
 * current personal tenant. `requested`: the personal tenant asked for, or
 * undefined for a work or school account.
 */
export function planSignIn(
  setting: string | null,
  remembered: string | null,
  requested: string | undefined,
): SignInPlan {
  if (setting !== null) return { kind: 'keep' };
  let wanted: string | null = null;
  if (requested !== undefined) {
    wanted = personalTenant(requested);
    if (wanted === null) return { kind: 'invalid', input: requested };
  }
  return wanted === remembered ? { kind: 'keep' } : { kind: 'switch', tenant: wanted };
}
