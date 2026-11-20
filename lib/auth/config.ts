import { authorityItem } from '../settings';
import { signInAuthorityItem } from './sign-in-choice';

/** Entra sign-in settings. */
export interface AuthConfig {
  clientId: string;
  /** `organizations`, `common`, a tenant ID or a tenant domain. */
  authority: string;
}

export const LOGIN_HOST = 'https://login.microsoftonline.com';

/**
 * ARM's only delegated permission. Access is read-only because the extension
 * only issues read calls; what the user can see is limited by their RBAC role.
 */
export const ARM_SCOPE = 'https://management.azure.com/user_impersonation';

/** `offline_access` gives a refresh token; `openid profile` gives the account name. */
export const SCOPES = [ARM_SCOPE, 'openid', 'profile', 'offline_access'];

/** Authority for a fresh install: the build's value, else `organizations`. */
export function defaultAuthority(): string {
  return import.meta.env.WXT_ENTRA_AUTHORITY || 'organizations';
}

/**
 * Client ID is fixed at build time (`WXT_ENTRA_CLIENT_ID`); the authority is
 * the user's setting, falling back to the build default.
 */
export async function readAuthConfig(): Promise<AuthConfig> {
  const clientId = import.meta.env.WXT_ENTRA_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'WXT_ENTRA_CLIENT_ID is not set: .env.local for dev builds, .env.production.local for store builds (see .env.example).',
    );
  }
  return { clientId, authority: await signInAuthority() };
}

/**
 * Authority for the home sign-in: the options-page setting, else the tenant
 * of a personal-account sign-in, else the build default (decision 006).
 */
export async function signInAuthority(): Promise<string> {
  return (
    (await authorityItem.getValue()) ?? (await signInAuthorityItem.getValue()) ?? defaultAuthority()
  );
}
