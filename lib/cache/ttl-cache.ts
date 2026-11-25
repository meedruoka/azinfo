import { storage } from 'wxt/utils/storage';

interface Entry<T> {
  value: T;
  storedAt: number;
}

/**
 * TTL cache over chrome.storage.local. Entries are keyed `<prefix><key>`, so
 * `clear()` can remove them all without touching other extension data.
 * `ttlMs` is read on every get, so a changed setting applies immediately.
 */
export function createTtlCache<T>(
  prefix: string,
  ttlMs: () => number | Promise<number>,
  now = Date.now,
) {
  const storageKey = (key: string) => `local:${prefix}${key}` as const;

  return {
    /** The value if stored less than the TTL ago, else null. */
    async get(key: string): Promise<{ value: T; storedAt: number } | null> {
      const entry = await storage.getItem<Entry<T>>(storageKey(key));
      if (!entry || now() - entry.storedAt >= (await ttlMs())) return null;
      return entry;
    },

    /** The stored value whatever its age, or null. */
    async peek(key: string): Promise<{ value: T; storedAt: number } | null> {
      return (await storage.getItem<Entry<T>>(storageKey(key))) ?? null;
    },

    async set(key: string, value: T): Promise<void> {
      await storage.setItem<Entry<T>>(storageKey(key), { value, storedAt: now() });
    },

    async clear(): Promise<void> {
      const all = await storage.snapshot('local');
      const keys = Object.keys(all)
        .filter((k) => k.startsWith(prefix))
        .map((k) => storageKey(k.slice(prefix.length)));
      if (keys.length) await storage.removeItems(keys);
    },
  };
}

export type TtlCache<T> = ReturnType<typeof createTtlCache<T>>;
