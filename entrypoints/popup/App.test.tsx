// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Request, ResponseMap } from '@/lib/messages';
import { App } from './App';

const HOME = 'aaaaaaaa-0000-0000-0000-000000000000';
const GUEST = 'bbbbbbbb-0000-0000-0000-000000000000';
const LOCKED = 'cccccccc-0000-0000-0000-000000000000';

const sub = (id: string, name: string, accessTenantId: string) => ({
  subscriptionId: id,
  displayName: name,
  state: 'Enabled',
  accessTenantId,
});

const DIRECTORY: ResponseMap['getDirectory'] = {
  tenants: [
    { tenantId: HOME, displayName: 'Home tenant', needsSignIn: false },
    { tenantId: GUEST, displayName: 'Guest tenant', needsSignIn: false },
    { tenantId: LOCKED, displayName: 'Locked tenant', needsSignIn: true },
  ],
  subscriptions: [sub('s1', 'Home sub', HOME), sub('s2', 'Guest sub', GUEST)],
  fetchedAt: 1,
};

function worker(directory = DIRECTORY) {
  return vi.fn(async (req: Request) => {
    switch (req.type) {
      case 'getAuthState':
        return { ok: true, data: { signedIn: true } };
      case 'getDirectory':
        return { ok: true, data: directory };
      case 'signInTenant':
        return { ok: true, data: { signedIn: true } };
      case 'getTopCosts':
        return { ok: true, data: { subscriptionId: req.subscriptionId, fetchedAt: 1, top: [] } };
      default:
        return { ok: false, kind: 'unknown', message: 'unexpected' };
    }
  });
}

describe('popup', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(cleanup);

  it('groups subscriptions by tenant and flags tenants that need sign-in', async () => {
    render(<App request={worker() as never} />);
    const select = (await screen.findByLabelText('Subscription')) as HTMLSelectElement;
    const groups = [...select.querySelectorAll('optgroup')].map((g) => [
      g.label,
      [...g.querySelectorAll('option')].map((o) => o.textContent),
    ]);
    expect(groups).toEqual([
      ['Home tenant', ['Home sub']],
      ['Guest tenant', ['Guest sub']],
    ]);
    expect(screen.getByText('Locked tenant')).toBeTruthy();
    expect(screen.getByText(/needs you to sign in/)).toBeTruthy();
  });

  it('signs in to a tenant and reloads the directory', async () => {
    const request = worker();
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Subscription');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith({ type: 'signInTenant', tenantId: LOCKED }),
    );
    expect(request.mock.calls.filter(([r]) => r.type === 'getDirectory').length).toBe(2);
  });

  it('shows a flat list without groups for a single tenant', async () => {
    render(
      <App
        request={
          worker({
            tenants: [{ tenantId: HOME, displayName: 'Home tenant', needsSignIn: false }],
            subscriptions: [sub('s1', 'Home sub', HOME)],
            fetchedAt: 1,
          }) as never
        }
      />,
    );
    const select = (await screen.findByLabelText('Subscription')) as HTMLSelectElement;
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    expect(select.textContent).toBe('Home sub');
  });
});
