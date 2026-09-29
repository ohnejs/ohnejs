import { isNull } from '../is/is-null.ts';

const SECONDS = /^\d+$/;
const HTTP_DATE = /^[A-Za-z]{3,9}, [\w -]+ \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Reads a `Retry-After` header into the milliseconds to wait, or `null` when it is missing or malformed.
 * It takes whole seconds, or an HTTP date counted from `now`.
 * A date already past reads as `0`.
 *
 * @example
 * ```ts
 * parseRetryAfter('30')                                 // -> 30000
 * parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', now) // -> the milliseconds from now
 * parseRetryAfter('soon')                               // -> null
 * parseRetryAfter(null)                                 // -> null
 * ```
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (isNull(header)) return null;
  const value = header.trim();
  if (SECONDS.test(value)) return Number(value) * 1000;
  const date = HTTP_DATE.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? null : Math.max(date - now, 0);
}
