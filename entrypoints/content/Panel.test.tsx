// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Tip } from '@/lib/azure/advisor';
import type { MeterShare } from '@/lib/cost/breakdown';
import { costStatusItem } from '@/lib/cost/cost-service';
import type { Request, ResponseMap, Result, TipsResult } from '@/lib/messages';
import { type PortalContext, parsePortalUrl } from '@/lib/portal/parse-portal-url';
import { Panel, panelCollapsedItem } from './Panel';

const SUB = '44444444-0000-0000-0000-000000000000';
const BASE = `https://portal.azure.com/#@t.onmicrosoft.com/resource/subscriptions/${SUB}/resourceGroups/rg`;
const AT = Date.UTC(2026, 9, 4, 12);

const ctx = (path: string) => parsePortalUrl(`${BASE}${path}`) as PortalContext;
const APP = ctx('/providers/Microsoft.Web/sites/App-One/overview');
const DB = ctx('/providers/Microsoft.Sql/servers/s1/databases/db1/overview');
const RG = ctx('/overview');
const SPIKE_CONTEXT = { thresholdPct: 50, daysElapsed: 9 };

type CostResult = Result<ResponseMap['getResourceCost']>;
type GroupResult = Result<ResponseMap['getResourceGroupCosts']>;

const NO_TIPS: TipsResult = { ok: true, items: [], total: null };

function costOf(
  context: PortalContext,
  mtd: number,
  lastMonth: number,
  assessment = { projected: mtd * 3, spike: false },
  extra: { breakdown?: MeterShare[]; tips?: TipsResult } = {},
): CostResult {
  return {
    ok: true,
    data: {
      resourceId: context.resourceId,
      fetchedAt: AT,
      cost: { resourceId: context.resourceId, mtd, lastMonth, currency: 'EUR' },
      assessment,
      spikeContext: SPIKE_CONTEXT,
      breakdown: extra.breakdown ?? [],
      tips: extra.tips ?? NO_TIPS,
    },
  };
}

function groupOf(
  rows: { name: string; mtd: number; spike?: boolean; tips?: number }[],
  tips: TipsResult = NO_TIPS,
): GroupResult {
  const resources = rows.map((r) => ({
    resourceId: `${RG.resourceId}/providers/microsoft.web/sites/${r.name}`,
    name: r.name,
    type: 'microsoft.web/sites',
    mtd: r.mtd,
    lastMonth: 1,
    currency: 'EUR',
    assessment: { projected: r.mtd * 3, spike: r.spike ?? false },
    tipCount: r.tips ?? 0,
  }));
  return {
    ok: true,
    data: {
      resourceGroupId: RG.resourceId,
      fetchedAt: AT,
      resources,
      total: resources.length
        ? {
            mtd: resources.reduce((s, r) => s + r.mtd, 0),
            lastMonth: resources.length,
            currency: 'EUR',
          }
        : null,
      spikeContext: SPIKE_CONTEXT,
      breakdown: [],
      tips,
    },
  };
}

/** A fake worker whose answers the test releases explicitly. */
function deferredRequest() {
  const pending: { req: Request; resolve: (r: unknown) => void }[] = [];
  const request = vi.fn(
    (req: Request) => new Promise<unknown>((resolve) => pending.push({ req, resolve })),
  ) as unknown as typeof import('@/lib/messages').sendRequest;
  return { request, pending };
}

async function expand() {
  fireEvent.click(await screen.findByRole('button', { name: /expand/i }));
}

describe('Panel', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    // Start expanded so states are readable; collapse is tested separately.
    await panelCollapsedItem.setValue(false);
  });
  afterEach(cleanup);

  it('renders nothing outside resource and resource-group pages', () => {
    const request = vi.fn();
    const home = parsePortalUrl('https://portal.azure.com/#home');
    const { container, rerender } = render(<Panel context={home} request={request} />);
    expect(container.innerHTML).toBe('');
    rerender(<Panel context={null} request={request} />);
    expect(container.innerHTML).toBe('');
    expect(request).not.toHaveBeenCalled();
  });

  it('shows the projected month-end and a spike note when flagged', async () => {
    const request = vi.fn(async () => costOf(APP, 40, 20, { projected: 137.78, spike: true }));
    render(<Panel context={APP} request={request as never} />);
    expect(
      await screen.findByText(/Projected month-end is more than 50% above last month/),
    ).toBeTruthy();
    expect(screen.getByText(/137[.,]78/).className).toBe('spike');
  });

  it('labels an early projection and has none on the 1st', async () => {
    const early = costOf(APP, 4, 20, { projected: 31, spike: false });
    if (early.ok) early.data.spikeContext = { thresholdPct: 50, daysElapsed: 2 };
    const { unmount } = render(<Panel context={APP} request={vi.fn(async () => early) as never} />);
    expect(await screen.findByText(/\(early estimate\)/)).toBeTruthy();
    unmount();

    const first = costOf(APP, 1, 20, { projected: null as never, spike: false });
    if (first.ok) first.data.spikeContext = { thresholdPct: 50, daysElapsed: 0 };
    render(<Panel context={APP} request={vi.fn(async () => first) as never} />);
    expect(await screen.findByText('From tomorrow')).toBeTruthy();
  });

  describe('resource group', () => {
    it('asks for the group and lists its resources in the order given', async () => {
      const request = vi.fn(async (_req: Request) =>
        groupOf([
          { name: 'big', mtd: 30, spike: true },
          { name: 'mid', mtd: 10 },
          { name: 'small', mtd: 1 },
        ]),
      );
      render(<Panel context={RG} request={request as never} />);

      expect(await screen.findByText('Group this month so far')).toBeTruthy();
      expect(request).toHaveBeenCalledWith({
        type: 'getResourceGroupCosts',
        subscriptionId: SUB,
        resourceGroupId: RG.resourceId,
        tenantHint: 't.onmicrosoft.com',
        force: false,
      });
      const names = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);
      expect(names[0]).toMatch(/^▲big/);
      expect(names.map((n) => n?.match(/big|mid|small/)?.[0])).toEqual(['big', 'mid', 'small']);
      expect(screen.getByText(/1 resource projected more than 50%/)).toBeTruthy();
      expect(screen.getByText(/41[.,]00/)).toBeTruthy();
    });

    it('shows the group total and spike count on the pill', async () => {
      await panelCollapsedItem.setValue(true);
      const request = vi.fn(async () =>
        groupOf([
          { name: 'a', mtd: 2, spike: true },
          { name: 'b', mtd: 3, spike: true },
        ]),
      );
      render(<Panel context={RG} request={request as never} />);
      const pill = await screen.findByRole('button', { name: /2 spikes/ });
      expect(pill.textContent).toMatch(/5[.,]00 · 2 spikes/);
    });

    it('says so when no resource in the group has cost', async () => {
      render(<Panel context={RG} request={vi.fn(async () => groupOf([])) as never} />);
      expect(await screen.findByText(/No resources in this group have cost/)).toBeTruthy();
    });

    it('reaches the error states', async () => {
      render(
        <Panel
          context={RG}
          request={vi.fn(async () => ({ ok: false, kind: 'noCostAccess', message: '' })) as never}
        />,
      );
      expect(await screen.findByText(/Cost Management Reader/)).toBeTruthy();
    });

    it('switches between a resource and its group without a stale answer', async () => {
      const { request, pending } = deferredRequest();
      const { rerender } = render(<Panel context={APP} request={request} />);
      rerender(<Panel context={RG} request={request} />);
      await act(async () => pending[1]?.resolve(groupOf([{ name: 'only', mtd: 7 }])));
      await act(async () => pending[0]?.resolve(costOf(APP, 999, 1)));
      expect(await screen.findByText('Group this month so far')).toBeTruthy();
      expect(screen.queryByText(/999/)).toBeNull();
    });
  });

  it('asks the worker for the resource on its subscription', async () => {
    const { request, pending } = deferredRequest();
    render(<Panel context={APP} request={request} />);
    expect(await screen.findByText('Loading cost…')).toBeTruthy();
    expect(pending[0]?.req).toEqual({
      type: 'getResourceCost',
      subscriptionId: SUB,
      resourceId: APP.resourceId,
      tenantHint: 't.onmicrosoft.com',
      force: false,
    });
  });

  it('shows month-to-date, last month and the change', async () => {
    const request = vi.fn(async () => costOf(APP, 3, 12));
    render(<Panel context={APP} request={request as never} />);
    expect(await screen.findByText('So far vs. all of last month')).toBeTruthy();
    expect(screen.getByText('-75%')).toBeTruthy();
    expect(screen.getByText('App-One')).toBeTruthy();
    expect(screen.getByText('microsoft.web/sites')).toBeTruthy();
  });

  it.each([
    [{ ok: true, data: { resourceId: 'x', fetchedAt: AT, cost: null } }, /No cost recorded/],
    [{ ok: false, kind: 'notSignedIn', message: '' }, /Sign in to see/],
    [{ ok: false, kind: 'noCostAccess', message: '' }, /Cost Management Reader/],
    [{ ok: false, kind: 'rateLimited', message: '', retryAt: AT }, /rate limiting cost queries/],
    [{ ok: false, kind: 'azure', message: 'Something broke' }, /Something broke/],
  ] as const)('reaches the state for %o', async (result, text) => {
    render(<Panel context={APP} request={vi.fn(async () => result) as never} />);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('shows "rate limited, retrying" while the worker waits', async () => {
    const { request } = deferredRequest();
    render(<Panel context={APP} request={request} />);
    await screen.findByText('Loading cost…');
    await act(() => costStatusItem.setValue({ [SUB]: { state: 'rateLimited', retryAt: AT } }));
    expect(await screen.findByText(/Rate limited by Azure, retrying at/)).toBeTruthy();
  });

  it('ignores a late answer for a resource the user already left', async () => {
    const { request, pending } = deferredRequest();
    const { rerender } = render(<Panel context={APP} request={request} />);
    rerender(<Panel context={DB} request={request} />);

    await act(async () => pending[1]?.resolve(costOf(DB, 40, 20)));
    await act(async () => pending[0]?.resolve(costOf(APP, 999, 1)));

    expect(await screen.findByText('+100%')).toBeTruthy();
    expect(screen.getByText('db1')).toBeTruthy();
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it('signs in from the panel, then loads the cost', async () => {
    const answers: unknown[] = [
      { ok: false, kind: 'notSignedIn', message: '' },
      { ok: true, data: { signedIn: true } },
      costOf(APP, 5, 5),
    ];
    const request = vi.fn(async (_req: Request) => answers.shift());
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Work or school account' }));
    expect(await screen.findByText('0%')).toBeTruthy();
    expect(request.mock.calls.map(([r]) => (r as Request).type)).toEqual([
      'getResourceCost',
      'signIn',
      'getResourceCost',
    ]);
    // A work account signs in through the default: no personal tenant.
    expect(request.mock.calls[1]?.[0]).toEqual({ type: 'signIn' });
  });

  it('signs a personal account in through the tenant in the page address', async () => {
    const answers: unknown[] = [
      { ok: false, kind: 'notSignedIn', message: '' },
      { ok: true, data: { signedIn: true } },
      costOf(APP, 5, 5),
    ];
    const request = vi.fn(async (_req: Request) => answers.shift());
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personal Microsoft account' }));
    expect(await screen.findByText('0%')).toBeTruthy();
    expect(request.mock.calls[1]?.[0]).toEqual({
      type: 'signIn',
      personalTenant: 't.onmicrosoft.com',
    });
  });

  it('without a tenant in the address, offers only the work account and points to the popup', async () => {
    const noTenant = parsePortalUrl(
      `https://portal.azure.com/#resource/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Web/sites/App-One/overview`,
    ) as PortalContext;
    const request = vi.fn(async () => ({ ok: false, kind: 'notSignedIn', message: '' }));
    render(<Panel context={noTenant} request={request as never} />);
    expect(await screen.findByRole('button', { name: 'Work or school account' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Personal Microsoft account' })).toBeNull();
    expect(screen.getByText(/Sign in from the azinfo button/)).toBeTruthy();
  });

  it('offers a sign-in to the subscription tenant, then loads the cost', async () => {
    const answers: unknown[] = [
      { ok: false, kind: 'tenantSignIn', message: '', tenantId: 'bbbb' },
      { ok: true, data: { signedIn: true } },
      costOf(APP, 2, 2),
    ];
    const request = vi.fn(async (_req: Request) => answers.shift());
    render(<Panel context={APP} request={request as never} />);
    expect(await screen.findByText(/another tenant \(t\.onmicrosoft\.com\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to this tenant' }));
    expect(await screen.findByText('0%')).toBeTruthy();
    expect(request.mock.calls[1]?.[0]).toEqual({ type: 'signInTenant', tenantId: 'bbbb' });
  });

  it('says where to finish while the sign-in window is open', async () => {
    let finishSignIn: (answer: unknown) => void = () => {};
    const answers: unknown[] = [
      { ok: false, kind: 'tenantSignIn', message: '', tenantId: 'bbbb' },
      new Promise((resolve) => {
        finishSignIn = resolve;
      }),
      { ok: false, kind: 'tenantSignIn', message: 'access_denied', tenantId: 'bbbb' },
    ];
    const request = vi.fn(async (_req: Request) => answers.shift());
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to this tenant' }));

    expect(await screen.findByText(/finish signing in there/)).toBeTruthy();
    expect(screen.queryByText('Loading cost…')).toBeNull();

    // Refused there (e.g. admin approval): back to the tenant prompt, no hint left.
    finishSignIn({ ok: false, kind: 'tenantSignIn', message: 'access_denied', tenantId: 'bbbb' });
    expect(await screen.findByRole('button', { name: 'Sign in to this tenant' })).toBeTruthy();
    expect(screen.queryByText(/finish signing in there/)).toBeNull();
  });

  it('Refresh forces a new query', async () => {
    const request = vi.fn(async () => costOf(APP, 1, 1));
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    await screen.findByText('0%');
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
  });

  describe('breakdown and savings tips', () => {
    const VM_TIP: Tip = {
      id: 't1',
      resourceId: APP.resourceId,
      problem: 'Right-size underused app service plan',
      solution: 'Move to a smaller tier',
      impact: 'High',
      savings: { amount: 480, currency: 'EUR', period: 'year' },
    };

    it('shows this month by meter with shares', async () => {
      const breakdown = [
        { category: 'Virtual Machines', amount: 7, share: 0.7 },
        { category: 'Storage', amount: 3, share: 0.3 },
      ];
      const request = vi.fn(async () => costOf(APP, 10, 5, undefined, { breakdown }));
      render(<Panel context={APP} request={request as never} />);
      expect(await screen.findByText('This month by meter')).toBeTruthy();
      expect(screen.getByText('Virtual Machines')).toBeTruthy();
      expect(screen.getByText(/7[.,]00.*· 70%/)).toBeTruthy();
    });

    it('hides a breakdown with a single category', async () => {
      const breakdown = [{ category: 'Storage', amount: 3, share: 1 }];
      render(
        <Panel
          context={APP}
          request={vi.fn(async () => costOf(APP, 3, 1, undefined, { breakdown })) as never}
        />,
      );
      await screen.findByText('So far vs. all of last month');
      expect(screen.queryByText('This month by meter')).toBeNull();
    });

    it('shows Advisor tips with impact and yearly savings, and counts them in the pill', async () => {
      const tips: TipsResult = { ok: true, items: [VM_TIP], total: VM_TIP.savings ?? null };
      const request = vi.fn(async () => costOf(APP, 10, 5, undefined, { tips }));
      render(<Panel context={APP} request={request as never} />);
      expect(await screen.findByText('Savings tips (Azure Advisor)')).toBeTruthy();
      expect(screen.getByText('Right-size underused app service plan')).toBeTruthy();
      expect(screen.getByText('Move to a smaller tier')).toBeTruthy();
      expect(screen.getByText('High')).toBeTruthy();
      expect(screen.getByText(/Save ~.*480.*\/year/)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
      const pill = await screen.findByRole('button', { name: /expand/i });
      expect(pill.textContent).toMatch(/· 1 tip$/);
    });

    it('labels savings without a known period neutrally', async () => {
      const item = {
        ...VM_TIP,
        savings: { amount: 12, currency: 'EUR', period: 'unspecified' as const },
      };
      const tips: TipsResult = { ok: true, items: [item], total: item.savings };
      render(
        <Panel
          context={APP}
          request={vi.fn(async () => costOf(APP, 1, 1, undefined, { tips })) as never}
        />,
      );
      expect(await screen.findByText(/Estimated savings .*12/)).toBeTruthy();
    });

    it('still shows costs when tips are unavailable', async () => {
      const tips: TipsResult = { ok: false, reason: 'noAccess' };
      render(
        <Panel
          context={APP}
          request={vi.fn(async () => costOf(APP, 10, 5, undefined, { tips })) as never}
        />,
      );
      expect(
        await screen.findByText(/Savings tips unavailable: no access to Azure Advisor/),
      ).toBeTruthy();
      expect(screen.getByText(/10[.,]00/)).toBeTruthy();
    });

    it('marks resources with tips in the group and totals the savings', async () => {
      const second = {
        ...VM_TIP,
        id: 't2',
        resourceId: `${RG.resourceId}/providers/microsoft.web/sites/b`,
      };
      const tips: TipsResult = {
        ok: true,
        items: [VM_TIP, second],
        total: { amount: 960, currency: 'EUR', period: 'year' },
      };
      const request = vi.fn(async () =>
        groupOf(
          [
            { name: 'a', mtd: 5, tips: 1 },
            { name: 'b', mtd: 3 },
          ],
          tips,
        ),
      );
      render(<Panel context={RG} request={request as never} />);
      expect(
        await screen.findByText(/Savings tips \(Azure Advisor\) · Save ~.*960.*\/year/),
      ).toBeTruthy();
      expect(screen.getAllByTitle('Azure Advisor savings tip')).toHaveLength(1);
    });
  });

  it('collapses to a pill showing the month-to-date cost, and remembers it', async () => {
    const request = vi.fn(async () => costOf(APP, 3.5, 1));
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse' }));

    const pill = await screen.findByRole('button', { name: /expand/i });
    expect(pill.textContent).toMatch(/azinfo.*3[.,]50/);
    expect(await panelCollapsedItem.getValue()).toBe(true);

    await expand();
    expect(await screen.findByText('So far vs. all of last month')).toBeTruthy();
    expect(await panelCollapsedItem.getValue()).toBe(false);
  });
});
