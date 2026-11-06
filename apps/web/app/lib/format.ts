/** Exact yoctoNEAR → NEAR formatting with BigInt (no floating point anywhere). */
export function near(value?: string | number | null, digits = 4): string {
  if (value === undefined || value === null || value === '') return '—';
  try {
    const n = BigInt(value);
    const base = 10n ** 24n;
    const whole = n / base;
    const fraction = (n % base).toString().padStart(24, '0').slice(0, digits).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '—';
  }
}

export const short = (value?: string | null, head = 8, tail = 6): string =>
  !value ? '—' : value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ''}`;

export const human = (code: string): string => code.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function ago(ms?: string | number | null): string {
  if (!ms) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - Number(ms)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function pct(part?: string | null, whole?: string | null): number {
  try {
    const w = BigInt(whole ?? '0');
    if (w === 0n) return 0;
    return Math.min(100, Number((BigInt(part ?? '0') * 10000n) / w) / 100);
  } catch {
    return 0;
  }
}

export const date = (ms?: string | number | null): string => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—');
