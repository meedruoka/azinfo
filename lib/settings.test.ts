import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  cacheTtlHoursItem,
  clampSetting,
  normaliseAuthority,
  readCacheTtlMs,
  readSpikeThresholdPct,
  SPIKE_THRESHOLD,
  spikeThresholdPctItem,
} from './settings';

describe('normaliseAuthority', () => {
  it.each([
    ['organizations', 'organizations'],
    [' Common ', 'common'],
    ['yourname.onmicrosoft.com', 'yourname.onmicrosoft.com'],
    ['Contoso.COM', 'contoso.com'],
    ['72F988BF-86F1-41AF-91AB-2D7CD011DB47', '72f988bf-86f1-41af-91ab-2d7cd011db47'],
  ])('accepts %j', (input, expected) => {
    expect(normaliseAuthority(input)).toBe(expected);
  });

  it.each([
    'consumers',
    '',
    'localhost',
    'https://login.microsoftonline.com/contoso.com',
    'contoso.com/oauth2',
    'not a tenant',
    '-bad.example.com',
    '../common',
  ])('rejects %j', (input) => {
    expect(normaliseAuthority(input)).toBeNull();
  });
});

describe('clampSetting', () => {
  it('clamps to bounds and falls back for non-numbers', () => {
    expect(clampSetting(70, SPIKE_THRESHOLD)).toBe(70);
    expect(clampSetting(-5, SPIKE_THRESHOLD)).toBe(0);
    expect(clampSetting(9999, SPIKE_THRESHOLD)).toBe(500);
    expect(clampSetting(Number.NaN, SPIKE_THRESHOLD)).toBe(50);
    expect(clampSetting('70', SPIKE_THRESHOLD)).toBe(50);
  });
});

describe('setting readers', () => {
  beforeEach(() => fakeBrowser.reset());

  it('use defaults when nothing is stored', async () => {
    expect(await readSpikeThresholdPct()).toBe(50);
    expect(await readCacheTtlMs()).toBe(4 * 3_600_000);
  });

  it('read stored values and clamp out-of-range ones', async () => {
    await spikeThresholdPctItem.setValue(25);
    await cacheTtlHoursItem.setValue(100);
    expect(await readSpikeThresholdPct()).toBe(25);
    expect(await readCacheTtlMs()).toBe(24 * 3_600_000);
  });
});
