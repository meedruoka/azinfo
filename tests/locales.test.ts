import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = join(__dirname, '..', 'public', '_locales');
/** The languages azinfo ships (decisions 005 and 007). */
const EXPECTED = [
  'ar',
  'bn',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pt_BR',
  'ru',
  'zh_CN',
];

type Messages = Record<string, { message: string; description?: string }>;
const load = (locale: string): Messages =>
  JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8'));

const locales = readdirSync(LOCALES_DIR).sort();
const en = load('en');
/** `$1`…`$9` used by a message, sorted; `$$` is a literal dollar, not a slot. */
const slots = (text: string) =>
  [...text.replace(/\$\$/g, '').matchAll(/\$([1-9])/g)].map((m) => m[1]).sort();

describe('locales', () => {
  it('ships exactly the agreed languages', () => {
    expect(locales).toEqual(EXPECTED);
  });

  it.each(locales.filter((l) => l !== 'en'))('%s has the same keys as English', (locale) => {
    expect(Object.keys(load(locale)).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(locales)('%s keeps every substitution of the English text', (locale) => {
    const messages = load(locale);
    for (const [key, { message }] of Object.entries(messages)) {
      const english = en[key]?.message ?? '';
      expect({ key, slots: slots(message) }).toEqual({ key, slots: slots(english) });
      expect({ key, empty: message.trim() === '' }).toEqual({ key, empty: false });
    }
  });

  it.each(locales)('%s has no stray dollar signs', (locale) => {
    for (const [key, { message }] of Object.entries(load(locale))) {
      const stray = message.replace(/\$\$|\$[1-9]/g, '').includes('$');
      expect({ key, stray }).toEqual({ key, stray: false });
    }
  });

  it.each(locales)('%s keeps the store summary within 132 characters', (locale) => {
    const summary = load(locale).extDescription?.message ?? '';
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThanOrEqual(132);
  });

  it.each(locales)('%s keeps product and role names in English', (locale) => {
    const messages = load(locale);
    const keep: [string, string][] = [
      ['popupNoCostAccess', 'Cost Management Reader'],
      ['panelNoCostAccess', 'Cost Management Reader'],
      ['signInTrustNote', 'Cost Management Reader'],
      ['panelTipsHeading', 'Azure Advisor'],
      ['optInvalidTenant', 'organizations'],
      ['optInvalidTenant', 'common'],
      ['panelLabel', 'azinfo'],
      ['optTitle', 'azinfo'],
    ];
    for (const [key, term] of keep) {
      expect({ key, has: messages[key]?.message.includes(term) }).toEqual({ key, has: true });
    }
  });

  it('only uses keys Chrome accepts', () => {
    for (const key of Object.keys(en)) expect(key).toMatch(/^[A-Za-z0-9_]+$/);
  });
});
