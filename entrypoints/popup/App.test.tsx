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

describe('popup sign-in choice (decision 006)', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(cleanup);

  const PERSONAL = 'yourname.onmicrosoft.com';

  function signedOut(choice: { chooseAccount: boolean; lastPortalTenant: string | null }) {
    return vi.fn(async (req: Request) => {
      switch (req.type) {
        case 'getAuthState':
          return { ok: true, data: { signedIn: false, ...choice } };
        case 'signIn':
          return { ok: true, data: { signedIn: true } };
        case 'getDirectory':
          return { ok: true, data: DIRECTORY };
        case 'getTopCosts':
          return { ok: true, data: { subscriptionId: req.subscriptionId, fetchedAt: 1, top: [] } };
        default:
          return { ok: false, kind: 'unknown', message: 'unexpected' };
      }
    });
  }

  it('signs a work or school account in through the default', async () => {
    const request = signedOut({ chooseAccount: true, lastPortalTenant: null });
    render(<App request={request as never} />);
    expect(await screen.findByText('Which account do you use for Azure?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Work or school account' }));
    await screen.findByLabelText('Subscription');
    expect(request).toHaveBeenCalledWith({ type: 'signIn' });
  });

  it('pre-fills the last portal tenant for a personal account', async () => {
    const request = signedOut({ chooseAccount: true, lastPortalTenant: PERSONAL });
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personal Microsoft account' }));
    const input = screen.getByLabelText('Your tenant') as HTMLInputElement;
    expect(input.value).toBe(PERSONAL);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Subscription');
    expect(request).toHaveBeenCalledWith({ type: 'signIn', personalTenant: PERSONAL });
  });

  it('refuses organizations as a personal tenant without calling the worker', async () => {
    const request = signedOut({ chooseAccount: true, lastPortalTenant: null });
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personal Microsoft account' }));
    fireEvent.change(screen.getByLabelText('Your tenant'), { target: { value: 'organizations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Enter your tenant domain/)).toBeTruthy();
    expect(request.mock.calls.some(([r]) => r.type === 'signIn')).toBe(false);
  });

  it('shows one Sign in button when a tenant is set on the options page', async () => {
    const request = signedOut({ chooseAccount: false, lastPortalTenant: PERSONAL });
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.queryByRole('button', { name: 'Personal Microsoft account' })).toBeNull();
    await screen.findByLabelText('Subscription');
    expect(request).toHaveBeenCalledWith({ type: 'signIn' });
  });
});

describe('popup after the session ended (0.1.2)', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(cleanup);

  const PERSONAL = 'yourname.onmicrosoft.com';

  function returningWorker(rememberedTenant: string | null) {
    return vi.fn(async (req: Request) => {
      switch (req.type) {
        case 'getAuthState':
          return {
            ok: true,
            data: {
              signedIn: false,
              chooseAccount: true,
              lastPortalTenant: null,
              returning: true,
              rememberedTenant,
            },
          };
        case 'signIn':
          return { ok: true, data: { signedIn: true } };
        case 'getDirectory':
          return { ok: true, data: DIRECTORY };
        case 'getTopCosts':
          return { ok: true, data: { subscriptionId: req.subscriptionId, fetchedAt: 1, top: [] } };
        default:
          return { ok: false, kind: 'unknown', message: 'unexpected' };
      }
    });
  }

  it('signs a personal account in again with one click, through the remembered tenant', async () => {
    const request = returningWorker(PERSONAL);
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: `Sign in again (${PERSONAL})` }));
    await screen.findByLabelText('Subscription');
    expect(request).toHaveBeenCalledWith({ type: 'signIn', personalTenant: PERSONAL });
  });

  it('signs a work account in again with one click', async () => {
    const request = returningWorker(null);
    render(<App request={request as never} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign in again (work or school account)' }),
    );
    await screen.findByLabelText('Subscription');
    expect(request).toHaveBeenCalledWith({ type: 'signIn' });
  });

  it('offers the full choice under "Use another account", with the remembered tenant filled in', async () => {
    const request = returningWorker(PERSONAL);
    render(<App request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use another account' }));
    expect(screen.getByText('Which account do you use for Azure?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Personal Microsoft account' }));
    expect((screen.getByLabelText('Your tenant') as HTMLInputElement).value).toBe(PERSONAL);
  });
});
