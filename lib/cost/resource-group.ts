import type { ResourceCost } from './normalise';

/**
 * Resources whose ID lies inside the resource group. Matching on
 * `<rgId>/` (with the slash) keeps `rg` from also matching `rg-2`.
 */
export function resourcesInGroup(
  resources: Record<string, ResourceCost>,
  resourceGroupId: string,
): ResourceCost[] {
  const prefix = `${resourceGroupId.toLowerCase().replace(/\/+$/, '')}/`;
  return Object.values(resources).filter((r) => r.resourceId.startsWith(prefix));
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
