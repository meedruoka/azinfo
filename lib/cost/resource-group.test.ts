import { describe, expect, it } from 'vitest';
import type { ResourceCost } from './normalise';
import { resourcesInGroup, totalOf } from './resource-group';

const SUB = '/subscriptions/44444444-0000-0000-0000-000000000000';
const r = (id: string, mtd = 1, lastMonth = 0, currency = 'EUR'): ResourceCost => ({
  resourceId: id,
  mtd,
  lastMonth,
  currency,
});
const byId = (list: ResourceCost[]) => Object.fromEntries(list.map((x) => [x.resourceId, x]));

const resources = byId([
  r(`${SUB}/resourcegroups/rg/providers/microsoft.web/sites/app`),
  r(`${SUB}/resourcegroups/rg/providers/microsoft.sql/servers/s1/databases/db1`),
  r(`${SUB}/resourcegroups/rg-2/providers/microsoft.web/sites/other`),
  r(`${SUB}/resourcegroups/rgx/providers/microsoft.web/sites/third`),
]);

describe('resourcesInGroup', () => {
  it('keeps resources in the group, including nested ones, and not rg-2 or rgx', () => {
    const ids = resourcesInGroup(resources, `${SUB}/resourcegroups/rg`).map((x) => x.resourceId);
    expect(ids).toEqual([
      `${SUB}/resourcegroups/rg/providers/microsoft.web/sites/app`,
      `${SUB}/resourcegroups/rg/providers/microsoft.sql/servers/s1/databases/db1`,
    ]);
  });

  it('matches regardless of the casing or a trailing slash in the group ID', () => {
    expect(resourcesInGroup(resources, `${SUB.toUpperCase()}/resourceGroups/RG/`)).toHaveLength(2);
  });

  it('returns an empty list for a group with no costed resources', () => {
    expect(resourcesInGroup(resources, `${SUB}/resourcegroups/empty`)).toEqual([]);
  });
});

describe('totalOf', () => {
  it('sums one currency', () => {
    expect(totalOf([r('a', 1.5, 2), r('b', 2, 3)])).toEqual({
      mtd: 3.5,
      lastMonth: 5,
      currency: 'EUR',
    });
  });

  it('refuses to add different currencies', () => {
    expect(totalOf([r('a', 1, 1, 'EUR'), r('b', 1, 1, 'USD')])).toBeNull();
  });

  it('is null for no resources', () => {
    expect(totalOf([])).toBeNull();
  });
});
