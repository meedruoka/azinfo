import en from '@/public/_locales/en/messages.json';

/**
 * UI text through the browser's extension i18n (`_locales/<lang>/messages.json`),
 * which picks the browser's UI language and falls back to English per message.
 * The English file is also bundled so text still appears where the browser API
 * is missing (tests) or returns nothing.
 */
export type MessageKey = keyof typeof en;

/** Keys that come as `<base>_one` / `<base>_other`. */
type PluralBase<K> = K extends `${infer B}_one` ? B : never;
export type PluralKey = PluralBase<MessageKey>;

export function t(key: MessageKey, ...subs: (string | number)[]): string {
  const strings = subs.map(String);
  let message = '';
  try {
    message = browser.i18n.getMessage(key, strings) ?? '';
  } catch {
    // No i18n API here: use the bundled English.
  }
  return message || substitute(en[key].message, strings);
}

/** `count` picks `<key>_one` or `<key>_other` by the UI language's plural rules; it is also $1. */
export function tp(key: PluralKey, count: number, ...subs: (string | number)[]): string {
  const form = new Intl.PluralRules(uiLocale()).select(count) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}` as MessageKey, count, ...subs);
}

/** The browser's UI language (e.g. `fr`, `pt-BR`), used for numbers, money and times. */
export function uiLocale(): string | undefined {
  try {
    return browser.i18n.getUILanguage() || undefined;
  } catch {
    return undefined;
  }
}

/** Chrome's rules: `$1`…`$9` are substitutions, `$$` is a literal dollar sign. */
export function substitute(template: string, subs: string[]): string {
  return template.replace(/\$(\$|[1-9])/g, (_, token: string) =>
    token === '$' ? '$' : (subs[Number(token) - 1] ?? ''),
  );
}

/**
 * Splits a message around its substitutions so they can be rendered as
 * elements (bold names, code samples): returns text parts and slot numbers.
 */
export function tParts(key: MessageKey, slots: number): (string | number)[] {
  const markers = Array.from({ length: slots }, (_, i) => `${SLOT}${i + 1}${SLOT}`);
  return t(key, ...markers)
    .split(SLOT_PATTERN)
    .map((part, i) => (i % 2 === 1 ? Number(part) : part))
    .filter((part) => part !== '');
}

/** A private-use character: never part of real text. */
const SLOT = String.fromCharCode(0xe000);
const SLOT_PATTERN = new RegExp(`${SLOT}([1-9])${SLOT}`);
