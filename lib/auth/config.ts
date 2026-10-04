/** Entra sign-in settings. Values come from `.env.local` (see `.env.example`). */
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

export function readAuthConfig(): AuthConfig {
  const clientId = import.meta.env.WXT_ENTRA_CLIENT_ID;
  if (!clientId) {
    throw new Error('WXT_ENTRA_CLIENT_ID is not set. Copy .env.example to .env.local.');
  }
  return {
    clientId,
    authority: import.meta.env.WXT_ENTRA_AUTHORITY || 'organizations',
  };
}
