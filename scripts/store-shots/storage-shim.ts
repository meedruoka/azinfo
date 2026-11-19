// In-memory stand-in for `wxt/utils/storage`, so the real UI components can
// render on a plain web page for store screenshots. Only what the UI uses.
type Listener = (value: unknown) => void;

const data = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

/** Values set before rendering (e.g. `local:panel.collapsed`). */
export function presetStorage(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) data.set(key, value);
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener(data.get(key));
}

export const storage = {
  defineItem<T>(key: string, options: { fallback?: T } = {}) {
    return {
      async getValue(): Promise<T> {
        return (data.has(key) ? data.get(key) : options.fallback) as T;
      },
      async setValue(value: T) {
        data.set(key, value);
        notify(key);
      },
      async removeValue() {
        data.delete(key);
        notify(key);
      },
      watch(callback: (value: T) => void) {
        const set = listeners.get(key) ?? new Set<Listener>();
        set.add(callback as Listener);
        listeners.set(key, set);
        return () => set.delete(callback as Listener);
      },
    };
  },
  async getItem<T>(key: string): Promise<T | null> {
    return (data.get(key) as T) ?? null;
  },
  async setItem(key: string, value: unknown) {
    data.set(key, value);
  },
  async removeItems(keys: string[]) {
    for (const key of keys) data.delete(key);
  },
  async snapshot(area: string) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of data) {
      if (key.startsWith(`${area}:`)) out[key.slice(area.length + 1)] = value;
    }
    return out;
  },
};
