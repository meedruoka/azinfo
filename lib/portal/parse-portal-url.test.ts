import { describe, expect, it } from 'vitest';
import { parsePortalUrl } from './parse-portal-url';

const SUB = '44444444-0000-0000-0000-000000000000';
const BASE = 'https://portal.azure.com/#@contoso.onmicrosoft.com/resource';

describe('parsePortalUrl', () => {
  it('parses a resource page and strips the blade', () => {
    const ctx = parsePortalUrl(
      `${BASE}/subscriptions/${SUB}/resourceGroups/Web-RG/providers/Microsoft.Web/sites/MyApp/overview`,
    );
    expect(ctx).toEqual({
      kind: 'resource',
      subscriptionId: SUB,
      resourceGroup: 'Web-RG',
      resourceId: `/subscriptions/${SUB}/resourcegroups/web-rg/providers/microsoft.web/sites/myapp`,
      name: 'MyApp',
    });
  });

  it('parses a resource page with no blade segment', () => {
    const ctx = parsePortalUrl(
      `${BASE}/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/stacct`,
    );
    expect(ctx?.kind).toBe('resource');
    expect(ctx?.resourceId).toBe(
      `/subscriptions/${SUB}/resourcegroups/rg/providers/microsoft.storage/storageaccounts/stacct`,
    );
  });

  it('parses a nested (child) resource', () => {
    const ctx = parsePortalUrl(
      `${BASE}/subscriptions/${SUB}/resourceGroups/data/providers/Microsoft.Sql/servers/sql1/databases/db1/overview`,
    );
    expect(ctx).toMatchObject({
      kind: 'resource',
      name: 'db1',
      resourceId: `/subscriptions/${SUB}/resourcegroups/data/providers/microsoft.sql/servers/sql1/databases/db1`,
    });
  });

  it('parses an extension resource with a second providers group', () => {
    const ctx = parsePortalUrl(
      `${BASE}/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Web/sites/app/providers/Microsoft.Insights/components/ai1/overview`,
    );
    expect(ctx?.resourceId).toBe(
      `/subscriptions/${SUB}/resourcegroups/rg/providers/microsoft.web/sites/app/providers/microsoft.insights/components/ai1`,
    );
  });

  it('parses a resource group page', () => {
    expect(parsePortalUrl(`${BASE}/subscriptions/${SUB}/resourceGroups/Web-RG/overview`)).toEqual({
      kind: 'resourceGroup',
      subscriptionId: SUB,
      resourceGroup: 'Web-RG',
      resourceId: `/subscriptions/${SUB}/resourcegroups/web-rg`,
    });
  });

  it('works without a tenant prefix and with a leading slash', () => {
    for (const hash of ['#resource', '#/resource']) {
      const ctx = parsePortalUrl(
        `https://portal.azure.com/${hash}/subscriptions/${SUB}/resourceGroups/rg/overview`,
      );
      expect(ctx?.kind).toBe('resourceGroup');
    }
  });

  it('lowercases the subscription ID and matches segment keywords case-insensitively', () => {
    const ctx = parsePortalUrl(
      `${BASE}/SUBSCRIPTIONS/${SUB.toUpperCase()}/RESOURCEGROUPS/rg/PROVIDERS/Microsoft.Web/sites/a`,
    );
    expect(ctx?.subscriptionId).toBe(SUB);
    expect(ctx?.resourceId).toBe(
      `/subscriptions/${SUB}/resourcegroups/rg/providers/microsoft.web/sites/a`,
    );
  });

  it('decodes percent-encoded segments', () => {
    const ctx = parsePortalUrl(
      `${BASE}/subscriptions/${SUB}/resourceGroups/my%28rg%29/providers/Microsoft.Web/sites/a`,
    );
    expect(ctx?.resourceGroup).toBe('my(rg)');
  });

  it('ignores a query string inside the hash', () => {
    const ctx = parsePortalUrl(`${BASE}/subscriptions/${SUB}/resourceGroups/rg/overview?x=1`);
    expect(ctx?.kind).toBe('resourceGroup');
  });

  it.each([
    ['another host', `https://example.com/#resource/subscriptions/${SUB}/resourceGroups/rg`],
    ['portal home', 'https://portal.azure.com/#home'],
    ['no hash', 'https://portal.azure.com/'],
    ['subscription page', `${BASE}/subscriptions/${SUB}/overview`],
    ['view-style blade', 'https://portal.azure.com/#view/Microsoft_Azure_CostManagement/Menu'],
    ['invalid subscription ID', `${BASE}/subscriptions/not-a-guid/resourceGroups/rg`],
    [
      'providers without a type/name',
      `${BASE}/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Web`,
    ],
    ['malformed encoding', `${BASE}/subscriptions/${SUB}/resourceGroups/%E0%A4%A`],
    ['not a URL', 'nonsense'],
  ])('returns null for %s', (_label, href) => {
    expect(parsePortalUrl(href)).toBeNull();
  });
});
