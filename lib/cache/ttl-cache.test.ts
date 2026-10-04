import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createTtlCache } from './ttl-cache';

const HOUR = 3_600_000;

describe('ttl cache', () => {
  let now = 1_000_000;
  const clock = () => now;

  beforeEach(() => {
    fakeBrowser.reset();
    now = 1_000_000;
  });

  it('returns a value until the TTL elapses', async () => {
    const cache = createTtlCache<string>('t.', () => 4 * HOUR, clock);
    await cache.set('a', 'hello');

    now += 4 * HOUR - 1;
    expect(await cache.get('a')).toEqual({ value: 'hello', storedAt: 1_000_000 });

    now += 1;
    expect(await cache.get('a')).toBeNull();
  });

  it('reads the TTL on each get, so a changed setting applies immediately', async () => {
    let ttl = 4 * HOUR;
    const cache = createTtlCache<number>('t.', () => ttl, clock);
    await cache.set('a', 1);
    now += HOUR;
    ttl = HOUR / 2;
    expect(await cache.get('a')).toBeNull();
  });

  it('stores entries in chrome.storage.local under its prefix', async () => {
    const cache = createTtlCache<number>('cost.v1.', () => HOUR, clock);
    await cache.set('sub', 42);
    expect(await fakeBrowser.storage.local.get('cost.v1.sub')).toEqual({
      'cost.v1.sub': { value: 42, storedAt: 1_000_000 },
    });
  });

  it('clear() removes only its own entries', async () => {
    const cache = createTtlCache<number>('cost.v1.', () => HOUR, clock);
    await cache.set('a', 1);
    await cache.set('b', 2);
    await fakeBrowser.storage.local.set({ 'auth.signedInIntent': true });

    await cache.clear();

    expect(await fakeBrowser.storage.local.get(null)).toEqual({ 'auth.signedInIntent': true });
  });
});
