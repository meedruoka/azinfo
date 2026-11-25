import { describe, expect, it } from 'vitest';
import { isAllowedRequest } from './sender-policy';

const self = { id: 'abc', origin: 'chrome-extension://abc' };
const popup = { id: 'abc', url: 'chrome-extension://abc/popup.html' };
const panel = { id: 'abc', url: 'https://portal.azure.com/#@x/resource/subscriptions/1' };

describe('isAllowedRequest', () => {
  it('lets the extension pages send anything', () => {
    for (const type of ['signOut', 'setAuthority', 'clearCache', 'getDirectory']) {
      expect(isAllowedRequest({ type }, popup, self)).toBe(true);
    }
  });

  it('limits the portal panel to reading costs and signing in', () => {
    for (const type of [
      'getResourceCost',
      'getResourceGroupCosts',
      'getTrend',
      'signIn',
      'signInTenant',
    ]) {
      expect(isAllowedRequest({ type }, panel, self)).toBe(true);
    }
    for (const type of ['signOut', 'setAuthority', 'clearCache', 'getDirectory', 'getTopCosts']) {
      expect(isAllowedRequest({ type }, panel, self)).toBe(false);
    }
  });

  it('rejects other senders and malformed requests', () => {
    const type = 'getResourceCost';
    expect(isAllowedRequest({ type }, { ...panel, id: 'other' }, self)).toBe(false);
    expect(isAllowedRequest({ type }, { id: 'abc', url: 'https://evil.example/' }, self)).toBe(
      false,
    );
    expect(isAllowedRequest({ type }, { id: 'abc' }, self)).toBe(false);
    expect(isAllowedRequest({ type }, { id: 'abc', url: 'not a url' }, self)).toBe(false);
    expect(isAllowedRequest(null, popup, self)).toBe(false);
    expect(isAllowedRequest({ type: 42 }, popup, self)).toBe(false);
  });
});
