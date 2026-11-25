import type { Request } from './messages';

/**
 * What the in-portal panel may ask the worker for: read costs and start a
 * sign-in. Signing out, changing the tenant or clearing data stay with the
 * extension's own pages (popup, options).
 */
export const CONTENT_SCRIPT_REQUESTS: ReadonlySet<Request['type']> = new Set([
  'getResourceCost',
  'getResourceGroupCosts',
  'getTrend',
  'signIn',
  'signInTenant',
]);

const PORTAL_ORIGIN = 'https://portal.azure.com';

export interface MessageSender {
  id?: string;
  url?: string;
}

export interface ExtensionIdentity {
  id: string;
  /** e.g. `chrome-extension://<id>`, no trailing slash. */
  origin: string;
}

/**
 * Whether the worker should handle `request` from `sender`. Only this
 * extension's own contexts count: its pages get every request, its portal
 * content script only {@link CONTENT_SCRIPT_REQUESTS}.
 */
export function isAllowedRequest(
  request: unknown,
  sender: MessageSender,
  self: ExtensionIdentity,
): request is Request {
  if (sender.id !== self.id || !sender.url) return false;
  if (typeof request !== 'object' || request === null) return false;
  const type = (request as { type?: unknown }).type;
  if (typeof type !== 'string') return false;

  const origin = originOf(sender.url);
  if (!origin) return false;
  if (origin === self.origin) return true;
  if (origin === PORTAL_ORIGIN) return CONTENT_SCRIPT_REQUESTS.has(type as Request['type']);
  return false;
}

/**
 * `scheme://host` of a URL, or null. Spelled out because URL.origin is
 * "null" for chrome-extension:// URLs outside the browser.
 */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}
