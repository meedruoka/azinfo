import type { ResourceCost } from './normalise';

/**
 * Whether a lowercased resource ID lies inside the resource group. Matching
 * on `<rgId>/` (with the slash) keeps `rg` from also matching `rg-2`.
 */
export function groupMatcher(resourceGroupId: string): (resourceId: string) => boolean {
  const prefix = `${resourceGroupId.toLowerCase().replace(/\/+$/, '')}/`;
  return (resourceId) => resourceId.startsWith(prefix);
}

/** Resources whose ID lies inside the resource group. */
export function resourcesInGroup(
  resources: Record<string, ResourceCost>,
  resourceGroupId: string,
): ResourceCost[] {
  const inGroup = groupMatcher(resourceGroupId);
  return Object.values(resources).filter((r) => inGroup(r.resourceId));
}

/**
 * Sum over resources, or null if they don't share one currency (adding
 * different currencies would give a meaningless number).
 */
export function totalOf(
  resources: ResourceCost[],
): { mtd: number; lastMonth: number; currency: string } | null {
  const currency = resources[0]?.currency;
  if (!currency || resources.some((r) => r.currency !== currency)) return null;
  return {
    mtd: resources.reduce((s, r) => s + r.mtd, 0),
    lastMonth: resources.reduce((s, r) => s + r.lastMonth, 0),
    currency,
  };
}
