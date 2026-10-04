// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultAuthority } from '@/lib/auth/config';
import type { Request } from '@/lib/messages';
import { authorityItem, cacheTtlHoursItem, spikeThresholdPctItem } from '@/lib/settings';
import { Options } from './Options';

function fakeWorker() {
  return vi.fn(async (req: Request) => {
    if (req.type === 'setAuthority') {
      const authority = req.authority ?? 'organizations';
      await authorityItem.setValue(req.authority);
      return { ok: true, data: { authority } };
    }
    if (req.type === 'clearCache') return { ok: true, data: { cleared: true } };
    return { ok: false, kind: 'unknown', message: 'unexpected' };
  });
}

describe('Options', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(cleanup);

  it('shows the defaults on a fresh install', async () => {
    render(<Options request={fakeWorker() as never} />);
    const tenant = (await screen.findByLabelText('Microsoft Entra tenant')) as HTMLInputElement;
    // The build default comes from WXT_ENTRA_AUTHORITY (else organizations).
    await vi.waitFor(() => expect(tenant.value).toBe(defaultAuthority()));
    expect((screen.getByLabelText('Reuse cost data for') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText(/Flag when projected month-end/) as HTMLInputElement).value).toBe(
      '50',
    );
  });

  it('saves a tenant through the worker, normalised, and offers a reset', async () => {
    const request = fakeWorker();
    render(<Options request={request as never} />);
    const input = await screen.findByLabelText('Microsoft Entra tenant');
    fireEvent.change(input, { target: { value: ' MeedAkourGmail.onmicrosoft.com ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(await screen.findByText(/You have been signed out/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith({
      type: 'setAuthority',
      authority: 'meedakourgmail.onmicrosoft.com',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to default' }));
    expect(await screen.findByText(/Saved: organizations/)).toBeTruthy();
    expect(request).toHaveBeenLastCalledWith({ type: 'setAuthority', authority: null });
  });

  it('rejects an invalid tenant without calling the worker', async () => {
    const request = fakeWorker();
    render(<Options request={request as never} />);
    const input = await screen.findByLabelText('Microsoft Entra tenant');
    fireEvent.change(input, { target: { value: 'consumers' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    expect(await screen.findByText(/Enter organizations, common/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('saves the cache duration and spike threshold, rejecting out-of-range values', async () => {
    render(<Options request={fakeWorker() as never} />);
    const ttl = await screen.findByLabelText('Reuse cost data for');
    const saves = screen.getAllByRole('button', { name: 'Save' });

    fireEvent.change(ttl, { target: { value: '30' } });
    fireEvent.click(saves[1] as HTMLElement);
    expect(await screen.findByText('Enter a number from 1 to 24.')).toBeTruthy();
    expect(await cacheTtlHoursItem.getValue()).toBe(4);

    fireEvent.change(ttl, { target: { value: '2' } });
    fireEvent.click(saves[1] as HTMLElement);
    await screen.findAllByText('Saved.');
    expect(await cacheTtlHoursItem.getValue()).toBe(2);

    const threshold = screen.getByLabelText(/Flag when projected month-end/);
    fireEvent.change(threshold, { target: { value: '120' } });
    fireEvent.click(saves[2] as HTMLElement);
    await vi.waitFor(async () => expect(await spikeThresholdPctItem.getValue()).toBe(120));
  });

  it('clears cached data through the worker', async () => {
    const request = fakeWorker();
    render(<Options request={request as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear cached data' }));
    expect(await screen.findByText(/Cached cost data cleared/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith({ type: 'clearCache' });
  });
});
