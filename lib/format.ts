import { uiLocale } from './i18n';

/** Amount in the currency Azure returned; never assumes USD. Formatted for the UI language. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(uiLocale(), { style: 'currency', currency }).format(amount);
  } catch {
    // Unknown currency code: show it as text rather than guess.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** Whole percent with a sign, e.g. `+12%`, `-3%`, `0%` (`+12 %` in French). */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat(uiLocale(), {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(Math.round(value) / 100);
}

/** A 0..1 share as a whole percent, e.g. `70%` (`70 %` in French). */
export function formatShare(share: number): string {
  return new Intl.NumberFormat(uiLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(
    share,
  );
}
