import { z } from 'zod';
import { API_VERSIONS } from './api-versions';
import { ARM_HOST, armList } from './arm-client';

const TenantResponse = z.object({
  tenantId: z.string(),
  displayName: z.string().nullish(),
  defaultDomain: z.string().nullish(),
  domains: z.array(z.string()).nullish(),
  /** Home: the user belongs to it. ProjectedBy / ManagedBy: Lighthouse relations. */
  tenantCategory: z.string().nullish(),
});

export interface Tenant {
  /** Lowercase tenant ID. */
  tenantId: string;
  displayName: string;
  /** Lowercase domains, used to match the portal URL's `#@<domain>`. */
  domains: string[];
  category: string;
}

export async function listTenants(accessToken: string): Promise<Tenant[]> {
  const raw = await armList(
    `${ARM_HOST}/tenants?api-version=${API_VERSIONS.tenants}`,
    accessToken,
    TenantResponse,
  );
  return raw.map((t) => {
    const domains = [...new Set([t.defaultDomain, ...(t.domains ?? [])])]
      .filter((d): d is string => !!d)
      .map((d) => d.toLowerCase());
    return {
      tenantId: t.tenantId.toLowerCase(),
      displayName: t.displayName || t.defaultDomain || t.tenantId,
      domains,
      category: t.tenantCategory ?? 'Home',
    };
  });
}
