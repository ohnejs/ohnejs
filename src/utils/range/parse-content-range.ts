import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * A parsed `Content-Range` header.
 * `start` and `end` come together, or neither does for an unsatisfied range.
 */
export interface ContentRange {
  /**
   * The first byte offset the body carries, inclusive.
   */
  start?: number;

  /**
   * The last byte offset the body carries, inclusive.
   */
  end?: number;

  /**
   * The size of the whole representation; absent when the sender wrote `*`.
   */
  size?: number;
}

const CONTENT_RANGE = /^bytes\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/;

/**
 * Parses a `Content-Range` header: a range and the size, either of them `*` when unknown or unsatisfied.
 * A malformed header, an inverted range, a range past the size, or `*` for both returns `null`.
 *
 * @example
 * ```ts
 * parseContentRange('bytes 0-499/1000') // -> { start: 0, end: 499, size: 1000 }
 * parseContentRange('bytes 0-499/*')    // -> { start: 0, end: 499 }
 * parseContentRange('bytes *\/1000')    // -> { size: 1000 }
 * parseContentRange('bytes 500-0/1000') // -> null
 * ```
 */
export function parseContentRange(header: string): ContentRange | null {
  const match = CONTENT_RANGE.exec(header.trim());
  if (isNull(match)) return null;
  const [, first, last, total] = match;
  const size = total === '*' ? undefined : Number(total);
  if (isUndefined(first)) return isUndefined(size) ? null : { size };
  const start = Number(first);
  const end = Number(last);
  if (start > end || (!isUndefined(size) && end >= size)) return null;
  return isUndefined(size) ? { start, end } : { start, end, size };
}
