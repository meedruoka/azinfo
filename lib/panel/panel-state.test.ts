import { describe, expect, it } from 'vitest';
import { changeFrom, panelStateFromResult } from './panel-state';

const ID = '/subscriptions/s/resourcegroups/rg/providers/microsoft.web/sites/app';
const AT = 1_700_000_000_000;

describe('changeFrom', () => {
  it.each([
    [50, 100, { kind: 'percent', value: -50 }],
    [150, 100, { kind: 'percent', value: 50 }],
    [0, 100, { kind: 'percent', value: -100 }],
    [10, 0, { kind: 'new' }],
    [0, 0, { kind: 'none' }],
    // Last month a net credit of -20; this month +10: change is +150%.
    [10, -20, { kind: 'percent', value: 150 }],
  ])('mtd %s vs last month %s', (mtd, last, expected) => {
    expect(changeFrom(mtd, last)).toEqual(expected);
  });
});

describe('panelStateFromResult', () => {
  it('shows data with the change', () => {
    expect(
      panelStateFromResult({
        ok: true,
        data: {
          resourceId: ID,
          fetchedAt: AT,
          cost: { resourceId: ID, mtd: 3, lastMonth: 12, currency: 'EUR' },
        },
      }),
    ).toEqual({
      kind: 'data',
      mtd: 3,
      lastMonth: 12,
      currency: 'EUR',
      change: { kind: 'percent', value: -75 },
      fetchedAt: AT,
    });
  });

  it('shows "no data" when the resource has no cost rows', () => {
    expect(
      panelStateFromResult({ ok: true, data: { resourceId: ID, fetchedAt: AT, cost: null } }),
    ).toEqual({ kind: 'noData', fetchedAt: AT });
  });

  it.each([
    ['notSignedIn', { kind: 'notSignedIn' }],
    ['noCostAccess', { kind: 'noCostAccess' }],
    ['rateLimited', { kind: 'rateLimited', retryAt: AT }],
    ['azure', { kind: 'error', message: 'boom' }],
    ['unknown', { kind: 'error', message: 'boom' }],
  ] as const)('maps the %s error', (kind, expected) => {
    expect(panelStateFromResult({ ok: false, kind, message: 'boom', retryAt: AT })).toEqual(
      expected,
    );
  });
});
