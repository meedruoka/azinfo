/**
 * Identifies the Azure resource or resource group shown on a portal page,
 * from the URL alone. Never inspects the portal's DOM.
 *
 * Portal resource URLs carry an ARM ID in the hash, e.g.
 *   https://portal.azure.com/#@contoso.onmicrosoft.com/resource/subscriptions/<sub>/resourceGroups/<rg>/providers/<ns>/<type>/<name>/<blade>
 */

export type PortalContext =
  | {
      kind: 'resource';
      subscriptionId: string;
      resourceGroup: string;
      /** Full ARM resource ID, lowercased (Cost Management returns lowercase IDs). */
      resourceId: string;
      /** Resource name as shown in the URL, original casing. */
      name: string;
      /** Tenant from the URL's `#@<domain or ID>`, lowercased, if present. */
      tenant?: string;
    }
  | {
      kind: 'resourceGroup';
      subscriptionId: string;
      resourceGroup: string;
      /** ARM ID of the resource group, lowercased. */
      resourceId: string;
      /** Tenant from the URL's `#@<domain or ID>`, lowercased, if present. */
      tenant?: string;
    };

const PORTAL_HOST = 'portal.azure.com';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePortalUrl(href: string): PortalContext | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== PORTAL_HOST) return null;

  const segments = splitHash(url.hash);
  if (!segments) return null;

  // Optional "@tenant" prefix, then "resource".
  const tenant = segments[0]?.startsWith('@')
    ? segments[0].slice(1).toLowerCase() || undefined
    : undefined;
  let i = segments[0]?.startsWith('@') ? 1 : 0;
  if (lower(segments[i]) !== 'resource') return null;
  i++;

  if (lower(segments[i]) !== 'subscriptions') return null;
  const subscriptionId = segments[i + 1];
  if (!subscriptionId || !GUID.test(subscriptionId)) return null;
  i += 2;

  if (lower(segments[i]) !== 'resourcegroups') return null;
  const resourceGroup = segments[i + 1];
  if (!resourceGroup) return null;
  i += 2;

  const sub = subscriptionId.toLowerCase();
  const rgId = `/subscriptions/${sub}/resourcegroups/${resourceGroup}`.toLowerCase();

  if (lower(segments[i]) !== 'providers') {
    return { kind: 'resourceGroup', subscriptionId: sub, resourceGroup, resourceId: rgId, tenant };
  }

  // One or more "providers/<namespace>/(<type>/<name>)+" groups; nested and
  // extension resources repeat the group. A trailing odd segment is the blade.
  const idParts: string[] = [];
  let name = '';
  while (lower(segments[i]) === 'providers') {
    const namespace = segments[i + 1];
    if (!namespace) return null;
    idParts.push('providers', namespace);
    i += 2;

    let pairs = 0;
    while (i + 1 < segments.length && lower(segments[i]) !== 'providers') {
      const type = segments[i] as string;
      name = segments[i + 1] as string;
      idParts.push(type, name);
      i += 2;
      pairs++;
    }
    if (pairs === 0) return null;
  }

  return {
    kind: 'resource',
    subscriptionId: sub,
    resourceGroup,
    resourceId: `${rgId}/${idParts.join('/')}`.toLowerCase(),
    name,
    tenant,
  };
}

/** Splits the URL hash into decoded, non-empty path segments. */
function splitHash(hash: string): string[] | null {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  try {
    return path
      .split('/')
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

function lower(s: string | undefined): string | undefined {
  return s?.toLowerCase();
}
