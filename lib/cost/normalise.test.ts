import { describe, expect, it } from 'vitest';
import legacy from '@/tests/fixtures/cost-query-legacy.json';
import legacyPage2 from '@/tests/fixtures/cost-query-legacy-page2.json';
import mca from '@/tests/fixtures/cost-query-mca.json';
import meter from '@/tests/fixtures/cost-query-meter.json';
import realLayout from '@/tests/fixtures/cost-query-real-layout.json';
import {
  CostShapeError,
  detectColumns,
  normaliseCostRows,
  toMonthKey,
  topByMtd,
} from './normalise';

const OCT = { current: '2026-10', previous: '2026-09' };
const SUB1 = '/subscriptions/00000000-0000-0000-0000-000000000001';
const SUB2 = '/subscriptions/00000000-0000-0000-0000-000000000002';

describe('normaliseCostRows', () => {
  it('handles the legacy layout across pages, merging mixed-case IDs', () => {
    const rows = [...legacy.properties.rows, ...legacyPage2.properties.rows];
    const result = normaliseCostRows(legacy.properties.columns, rows, OCT);

    expect(result).toEqual({
      [`${SUB1}/resourcegroups/rg-web/providers/microsoft.web/sites/app-one`]: {
        resourceId: `${SUB1}/resourcegroups/rg-web/providers/microsoft.web/sites/app-one`,
        mtd: 4.25,
        lastMonth: 12.5,
        currency: 'EUR',
      },
      [`${SUB1}/resourcegroups/rg-data/providers/microsoft.sql/servers/sql1/databases/db1`]: {
        resourceId: `${SUB1}/resourcegroups/rg-data/providers/microsoft.sql/servers/sql1/databases/db1`,
        mtd: 30.75,
        lastMonth: 100,
        currency: 'EUR',
      },
    });
  });

  it('handles the MCA layout: other column order, ISO months, string numbers, extra columns', () => {
    const result = normaliseCostRows(mca.properties.columns, mca.properties.rows, OCT);
    const vm =
      result[`${SUB2}/resourcegroups/rg-vm/providers/microsoft.compute/virtualmachines/vm-1`];
    const ai =
      result[`${SUB2}/resourcegroups/rg-ai/providers/microsoft.cognitiveservices/accounts/ai-one`];

    // Cost (billing currency) is used, not CostUSD; August is outside the window.
    expect(vm).toMatchObject({ mtd: 50, lastMonth: 0, currency: 'GBP' });
    expect(ai).toMatchObject({ mtd: 2, lastMonth: 1, currency: 'GBP' });
  });

  it('handles the layout recorded from a real personal subscription', () => {
    const sub = '/subscriptions/00000000-0000-0000-0000-000000000003/resourcegroups/rg-test';
    const result = normaliseCostRows(
      realLayout.properties.columns,
      realLayout.properties.rows,
      OCT,
    );
    expect(Object.values(result)).toEqual([
      {
        resourceId: `${sub}/providers/microsoft.cognitiveservices/accounts/test-ai`,
        mtd: 3.21,
        lastMonth: 5.5,
        currency: 'EUR',
      },
      {
        resourceId: `${sub}/providers/microsoft.storage/storageaccounts/teststore`,
        mtd: 0.4,
        lastMonth: 0,
        currency: 'EUR',
      },
    ]);
  });

  it('splits this month by meter category when the query grouped by meter', () => {
    const result = normaliseCostRows(meter.properties.columns, meter.properties.rows, OCT);
    const vm =
      result[
        '/subscriptions/00000000-0000-0000-0000-000000000003/resourcegroups/rg-test/providers/microsoft.compute/virtualmachines/vm1'
      ];
    expect(vm).toEqual({
      resourceId: expect.any(String),
      mtd: 10,
      lastMonth: 9,
      currency: 'EUR',
      // Last month's rows don't count; an empty category becomes "Other".
      byMeter: { 'Virtual Machines': 7, Storage: 2, Other: 1 },
    });
  });

  it('leaves byMeter out when there is no meter column', () => {
    const result = normaliseCostRows(
      realLayout.properties.columns,
      realLayout.properties.rows,
      OCT,
    );
    expect(Object.values(result).every((r) => r.byMeter === undefined)).toBe(true);
  });

  it('returns nothing for an empty result (HTTP 204 or no rows)', () => {
    expect(normaliseCostRows([], [], OCT)).toEqual({});
  });

  it('fails clearly when a required column is missing', () => {
    const columns = [
      { name: 'PreTaxCost', type: 'Number' },
      { name: 'ResourceId', type: 'String' },
      { name: 'Currency', type: 'String' },
    ];
    expect(() => normaliseCostRows(columns, [[1, '/x', 'EUR']], OCT)).toThrow(
      new CostShapeError(
        'Cost response has no month column (columns: PreTaxCost, ResourceId, Currency)',
      ),
    );
  });

  it('rejects a non-numeric cost instead of showing a wrong number', () => {
    const rows = [
      ['/subscriptions/x/resourcegroups/r/providers/a.b/c/d', '2026-10-01', 'EUR', 'n/a', 'n/a'],
    ];
    expect(() => normaliseCostRows(mca.properties.columns, rows, OCT)).toThrow(CostShapeError);
  });
});

describe('detectColumns', () => {
  it('matches names case-insensitively and prefers Cost over CostUSD', () => {
    expect(
      detectColumns([
        { name: 'COSTUSD', type: 'Number' },
        { name: 'cost', type: 'Number' },
        { name: 'resourceid', type: 'String' },
        { name: 'CURRENCY', type: 'String' },
        { name: 'usagedate', type: 'Number' },
      ]),
    ).toEqual({ cost: 1, resourceId: 2, currency: 3, month: 4, meter: null });
  });

  it('finds the optional meter column under either name', () => {
    const base = [
      { name: 'Cost', type: 'Number' },
      { name: 'ResourceId', type: 'String' },
      { name: 'Currency', type: 'String' },
      { name: 'BillingMonth', type: 'Datetime' },
    ];
    expect(detectColumns([...base, { name: 'MeterCategory', type: 'String' }]).meter).toBe(4);
    expect(detectColumns([...base, { name: 'ServiceName', type: 'String' }]).meter).toBe(4);
  });
});

describe('toMonthKey', () => {
  it.each([
    [20261001, '2026-10'],
    ['20260930', '2026-09'],
    ['2026-09-01T00:00:00', '2026-09'],
    ['2026-09-01', '2026-09'],
    ['garbage', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(toMonthKey(input)).toBe(expected);
  });
});

describe('topByMtd', () => {
  it('sorts by month-to-date cost and limits the count', () => {
    const r = (id: string, mtd: number) => ({ resourceId: id, mtd, lastMonth: 0, currency: 'EUR' });
    const top = topByMtd({ a: r('a', 1), b: r('b', 5), c: r('c', 3) }, 2);
    expect(top.map((x) => x.resourceId)).toEqual(['b', 'c']);
  });
});
