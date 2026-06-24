import { isRealNumber } from '../is/is-real-number.ts';
import { clamp } from '../number/clamp.ts';

/**
 * A single parsed entry from an `Accept`-family header.
 */
export interface AcceptEntry {
  /**
   * The token, OWS-trimmed and lowercased (`'text/html'`, `'en-us'`, `'*'`).
   */
  value: string;

  /**
   * The quality weight in `[0, 1]`; `0` means explicitly not acceptable.
   */
  q: number;
}

/**
 * Parses any `Accept`-family header (`Accept`, `Accept-Language`, ...) into weighted entries.
 * Entries are sorted by quality descending, equal weights keeping their header order (stable sort).
 *
 * Each entry's `q` defaults to `1` and is clamped to `[0, 1]`; a garbled weight falls back to `1`.
 * The `q=` parameter is matched case-insensitively per RFC 9110.
 * Never throws: empty tokens are dropped, so a trailing comma or blank header yields no entry.
 *
 * @example
 * ```ts
 * parseAccept('en, de;q=0.9')
 * // -> [{ value: 'en', q: 1 }, { value: 'de', q: 0.9 }]
 *
 * parseAccept('text/*;q=0.8, text/html')
 * // -> [{ value: 'text/html', q: 1 }, { value: 'text/*', q: 0.8 }]
 * ```
 */
export function parseAccept(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];
  for (const part of header.split(',')) {
    const segments = part.split(';');
    const value = segments[0].trim().toLowerCase();
    if (value === '') continue;

    const weight = segments.slice(1).find((s) => s.trim().toLowerCase().startsWith('q='));
    const raw = weight ? Number.parseFloat(weight.trim().slice(2)) : 1;
    entries.push({ value, q: isRealNumber(raw) ? clamp(raw, 0, 1) : 1 });
  }
  return entries.sort((a, b) => b.q - a.q);
}
