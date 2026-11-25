import { describe, expect, it } from 'vitest';
import type { AssessedCost, TipsResult } from '../messages';
import { changeFrom, groupPanelStateFromResult, panelStateFromResult } from './panel-state';

const ID = '/subscriptions/s/resourcegroups/rg/providers/microsoft.web/sites/app';
const AT = 1_700_000_000_000;
const SPIKE_CONTEXT = { thresholdPct: 50, daysElapsed: 9 };

describe('changeFrom', () => {
  it.each([
    [50, 100, { kind: 'percent', value: -50 }],
    [150, 100, { kind: 'percent', value: 50 }],
    [0, 100, { kind: 'percent', value: -100 }],
    [10, 0, { kind: 'new' }],
    [0, 0, { kind: 'none' }],
    // Last month a net credit of -20; this month +10: change is +150%.
    [10, -20, { kind: 'percent', value: 150 }],
    // Both shown as 0.00: a fraction of a cent last month is not "-100%".
    [0, 0.003, { kind: 'none' }],
    [0.004, 0.001, { kind: 'none' }],
    [0.02, 0.004, { kind: 'new' }],
    [0, 0.01, { kind: 'percent', value: -100 }],
  ])('mtd %s vs last month %s', (mtd, last, expected) => {
    expect(changeFrom(mtd, last, 'USD')).toEqual(expected);
  });

  it('rounds to the currency minor unit (JPY has none)', () => {
    expect(changeFrom(0, 0.4, 'JPY')).toEqual({ kind: 'none' });
    expect(changeFrom(0, 1, 'JPY')).toEqual({ kind: 'percent', value: -100 });
  });

  it('treats an unknown currency code like 2 decimals', () => {
    expect(changeFrom(0, 0.003, 'XXQ')).toEqual({ kind: 'none' });
  });
});

const BREAKDOWN = [{ category: 'Virtual Machines', amount: 30, share: 1 }];
const NO_TIPS: TipsResult = { ok: true, items: [], total: null };

describe('panelStateFromResult', () => {
  it('shows data with the change, projection and spike flag', () => {
    expect(
      panelStateFromResult({
        ok: true,
        data: {
          resourceId: ID,
          fetchedAt: AT,
          costType: 'ActualCost',
          cost: { resourceId: ID, mtd: 30, lastMonth: 12, currency: 'EUR' },
          assessment: { projected: 103.3, spike: true },
          spikeContext: SPIKE_CONTEXT,
          breakdown: BREAKDOWN,
          tips: NO_TIPS,
        },
      }),
    ).toEqual({
      kind: 'data',
      mtd: 30,
      lastMonth: 12,
      currency: 'EUR',
      change: { kind: 'percent', value: 150 },
      projected: 103.3,
      spike: true,
      spikeContext: SPIKE_CONTEXT,
      fetchedAt: AT,
      costType: 'ActualCost',
      refreshing: false,
      breakdown: BREAKDOWN,
      tips: NO_TIPS,
    });
  });

  it('shows "no data" when the resource has no cost rows', () => {
    expect(
      panelStateFromResult({
        ok: true,
        data: {
          resourceId: ID,
          fetchedAt: AT,
          costType: 'ActualCost',
          cost: null,
          assessment: null,
          spikeContext: SPIKE_CONTEXT,
          breakdown: [],
          tips: NO_TIPS,
        },
      }),
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

describe('groupPanelStateFromResult', () => {
  const row = (name: string, spike: boolean): AssessedCost => ({
    resourceId: `${ID}-${name}`,
    name,
    type: 'microsoft.web/sites',
    mtd: 1,
    lastMonth: 1,
    currency: 'EUR',
    assessment: { projected: 3, spike },
  });

  it('counts spikes and keeps the worker order', () => {
    const state = groupPanelStateFromResult({
      ok: true,
      data: {
        resourceGroupId: '/subscriptions/s/resourcegroups/rg',
        fetchedAt: AT,
        costType: 'ActualCost',
        resources: [row('a', true), row('b', false), row('c', true)],
        total: { mtd: 3, lastMonth: 3, currency: 'EUR' },
        spikeContext: SPIKE_CONTEXT,
        breakdown: [],
        tips: NO_TIPS,
      },
    });
    expect(state).toMatchObject({ kind: 'group', spikes: 2 });
    expect(state.kind === 'group' && state.resources.map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('maps errors the same way as for a resource', () => {
    expect(groupPanelStateFromResult({ ok: false, kind: 'noCostAccess', message: '' })).toEqual({
      kind: 'noCostAccess',
    });
  });
});
