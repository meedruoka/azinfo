import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '@/public/_locales/fr/messages.json';
import { formatMoney, formatPercent, formatShare } from './format';
import { substitute, t, tParts, tp, uiLocale } from './i18n';

/** Makes the browser API answer from a locale file, like Chrome does. */
function browserLanguage(locale: string, messages: Record<string, { message: string }>) {
  vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue(locale);
  vi.spyOn(browser.i18n, 'getMessage').mockImplementation(((key: string, subs?: string[]) =>
    messages[key] ? substitute(messages[key].message, subs ?? []) : '') as never);
}

afterEach(() => vi.restoreAllMocks());

describe('substitute', () => {
  it('fills $1…$9 and keeps $$ as a dollar sign', () => {
    expect(substitute('Save $1 of $2 ($$)', ['€5', '€10'])).toBe('Save €5 of €10 ($)');
    expect(substitute('Missing $3', ['a'])).toBe('Missing ');
  });
});

describe('t', () => {
  it('falls back to the bundled English when the browser gives nothing', () => {
    expect(t('updatedAt', '14:05')).toBe('Updated 14:05. Azure cost data lags by several hours.');
  });

  it('uses the browser language when available', () => {
    browserLanguage('fr', fr);
    expect(t('signIn')).toBe('Se connecter');
    expect(t('optNumberRange', 1, 24)).toBe('Saisissez un nombre entre 1 et 24.');
  });
});

describe('tp', () => {
  it('picks the plural form and passes the count as $1', () => {
    expect(tp('pillTips', 1)).toBe('1 tip');
    expect(tp('pillTips', 3)).toBe('3 tips');
    expect(tp('panelSpikeNoteGroup', 2, 50)).toBe(
      '▲ 2 resources projected more than 50% above last month.',
    );
  });

  it("follows the language's rules: French uses the singular for 0 and 1", () => {
    browserLanguage('fr', fr);
    expect(tp('pillTips', 1)).toBe('1 conseil');
    expect(tp('pillTips', 2)).toBe('2 conseils');
  });
});

describe('tParts', () => {
  it('splits a message around its slots in the translated order', () => {
    expect(tParts('popupTenantFailed', 2)).toEqual([1, " couldn't be read: ", 2]);
    browserLanguage('es', { popupTenantFailed: { message: 'No se pudo leer $1: $2' } });
    expect(tParts('popupTenantFailed', 2)).toEqual(['No se pudo leer ', 1, ': ', 2]);
  });
});

describe('formatting follows the UI language', () => {
  it('formats money, percent and shares for French', () => {
    browserLanguage('fr', fr);
    expect(uiLocale()).toBe('fr');
    // Intl uses narrow no-break spaces in French; compare without them.
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(formatMoney(1234.5, 'EUR'))).toBe('1 234,50 €');
    expect(plain(formatPercent(12.4))).toBe('+12 %');
    expect(plain(formatShare(0.7))).toBe('70 %');
  });

  it('keeps English formatting by default', () => {
    expect(formatPercent(150)).toBe('+150%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(-3.6)).toBe('-4%');
  });
});

describe('no hard-coded UI text', () => {
  /**
   * Text allowed in JSX: the brand name, symbols, values to type (shown as
   * code, never translated) and a TypeScript generic the pattern also catches.
   */
  const ALLOWED = new Set([
    'azinfo',
    '–',
    '…',
    '▲',
    '·',
    'organizations',
    'yourname.onmicrosoft.com',
    'Promise',
  ]);
  const UI_DIRS = ['entrypoints/content', 'entrypoints/popup', 'entrypoints/options'];

  it.each(UI_DIRS)('%s renders only translated text', (dir) => {
    const root = join(__dirname, '..', dir);
    for (const file of readdirSync(root).filter((f) => /\.tsx$/.test(f) && !/test/.test(f))) {
      const source = readFileSync(join(root, file), 'utf8');
      // Text between a closing `>` and the next `<` or `{`, e.g. <p>Hello</p>.
      const texts = [...source.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)]
        .map((m) => (m[1] ?? '').trim())
        .filter((text) => text && !ALLOWED.has(text) && !/^[\s=&|?:()!.,]*$/.test(text))
        // Skip TypeScript generics and arrow functions that the regex can catch.
        .filter((text) => !/=>|\bconst\b|\btype\b|\breturn\b/.test(text));
      expect({ file, texts }).toEqual({ file, texts: [] });
      // Text in string attributes people read.
      const attributes = [
        ...source.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]+)"/g),
      ].map((m) => m[1]);
      expect({ file, attributes }).toEqual({ file, attributes: [] });
    }
  });
});
