// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { costStatusItem } from '@/lib/cost/cost-service';
import type { Request, ResponseMap, Result } from '@/lib/messages';
import { type PortalContext, parsePortalUrl } from '@/lib/portal/parse-portal-url';
import { Panel, panelCollapsedItem } from './Panel';

const SUB = '44444444-0000-0000-0000-000000000000';
const BASE = `https://portal.azure.com/#@t.onmicrosoft.com/resource/subscriptions/${SUB}/resourceGroups/rg`;
const AT = Date.UTC(2026, 9, 4, 12);

const ctx = (path: string) => parsePortalUrl(`${BASE}${path}`) as PortalContext;
const APP = ctx('/providers/Microsoft.Web/sites/App-One/overview');
const DB = ctx('/providers/Microsoft.Sql/servers/s1/databases/db1/overview');

type CostResult = Result<ResponseMap['getResourceCost']>;

function costOf(context: PortalContext, mtd: number, lastMonth: number): CostResult {
  return {
    ok: true,
    data: {
      resourceId: context.resourceId,
      fetchedAt: AT,
      cost: { resourceId: context.resourceId, mtd, lastMonth, currency: 'EUR' },
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

  it('renders nothing outside resource pages', () => {
    const request = vi.fn();
    const { container, rerender } = render(<Panel context={ctx('/overview')} request={request} />);
    expect(container.innerHTML).toBe('');
    rerender(<Panel context={null} request={request} />);
    expect(container.innerHTML).toBe('');
    expect(request).not.toHaveBeenCalled();
  });

  it('asks the worker for the resource on its subscription', async () => {
    const { request, pending } = deferredRequest();
    render(<Panel context={APP} request={request} />);
    expect(await screen.findByText('Loading cost…')).toBeTruthy();
    expect(pending[0]?.req).toEqual({
      type: 'getResourceCost',
      subscriptionId: SUB,
      resourceId: APP.resourceId,
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
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('0%')).toBeTruthy();
    expect(request.mock.calls.map(([r]) => (r as Request).type)).toEqual([
      'getResourceCost',
      'signIn',
      'getResourceCost',
    ]);
  });

  it('Refresh forces a new query', async () => {
    const request = vi.fn(async () => costOf(APP, 1, 1));
    render(<Panel context={APP} request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    await screen.findByText('0%');
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
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
