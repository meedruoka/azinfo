/** Amount in the currency Azure returned; never assumes USD. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    // Unknown currency code: show it as text rather than guess.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
