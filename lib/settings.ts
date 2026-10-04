import { storage } from 'wxt/utils/storage';

/** User settings, edited on the options page. Readers clamp bad values to defaults. */

export const SPIKE_THRESHOLD = { default: 50, min: 0, max: 500 } as const;
export const CACHE_TTL_HOURS = { default: 4, min: 1, max: 24 } as const;

/**
 * Spike threshold: flag when projected month-end is more than this many
 * percent above last month.
 */
export const spikeThresholdPctItem = storage.defineItem<number>(
  'local:settings.spikeThresholdPct',
  { fallback: SPIKE_THRESHOLD.default },
);

/** How long cost data is reused before querying Azure again. */
export const cacheTtlHoursItem = storage.defineItem<number>('local:settings.cacheTtlHours', {
  fallback: CACHE_TTL_HOURS.default,
});

/**
 * Entra authority used for sign-in. Null means "use the build default"
 * (`WXT_ENTRA_AUTHORITY`, else `organizations`).
 */
export const authorityItem = storage.defineItem<string | null>('local:settings.authority', {
  fallback: null,
});

export function clampSetting(
  value: unknown,
  bounds: { default: number; min: number; max: number },
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(bounds.max, Math.max(bounds.min, value))
    : bounds.default;
}

export async function readSpikeThresholdPct(): Promise<number> {
  return clampSetting(await spikeThresholdPctItem.getValue(), SPIKE_THRESHOLD);
}

export async function readCacheTtlMs(): Promise<number> {
  return clampSetting(await cacheTtlHoursItem.getValue(), CACHE_TTL_HOURS) * 60 * 60 * 1000;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN =
  /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * A valid authority, normalised to lowercase, or null. Accepts
 * `organizations`, `common`, a tenant GUID or a tenant domain. `consumers`
 * is rejected: Azure subscriptions are always in a tenant, so ARM tokens
 * can't come from the consumers endpoint.
 */
export function normaliseAuthority(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value === 'organizations' || value === 'common') return value;
  if (GUID.test(value) || DOMAIN.test(value)) return value;
  return null;
}
