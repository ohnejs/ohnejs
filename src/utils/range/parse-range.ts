/**
 * A single byte range, both bounds inclusive.
 */
export interface ByteRange {
  /**
   * The first byte offset, inclusive.
   */
  start: number;

  /**
   * The last byte offset, inclusive.
   */
  end: number;
}

/**
 * The outcome of parsing a `Range` header against a known size.
 *
 * - `satisfiable` carries one or more in-bounds ranges; answer `206` with `Content-Range`.
 * - `unsatisfiable` means every range fell outside the size; answer `416`.
 * - `ignore` means there is no usable byte range (absent, malformed, or an unknown unit); serve `200`.
 */
export type RangeResult =
  | {
      /**
       * Discriminator for a request with at least one in-bounds range.
       */
      type: 'satisfiable';

      /**
       * The requested ranges, clamped to the size, in the order received.
       */
      ranges: ByteRange[];
    }
  | {
      /**
       * Discriminator for a syntactically valid request whose ranges all fall outside the size.
       */
      type: 'unsatisfiable';
    }
  | {
      /**
       * Discriminator for an absent, malformed, or non-`bytes` request the server should ignore.
       */
      type: 'ignore';
    };

const POSITION = /^\d+$/;

function parseSpec(spec: string, size: number): ByteRange | 'unsatisfiable' | 'malformed' {
  const dash = spec.indexOf('-');
  if (dash === -1) return 'malformed';

  const startText = spec.slice(0, dash).trim();
  const endText = spec.slice(dash + 1).trim();

  if (startText === '') {
    if (!POSITION.test(endText)) return 'malformed';
    const start = Math.max(size - Number(endText), 0);
    return Number(endText) > 0 && start <= size - 1 ? { start, end: size - 1 } : 'unsatisfiable';
  }

  if (!POSITION.test(startText)) return 'malformed';
  const start = Number(startText);

  let end = size - 1;
  if (endText !== '') {
    if (!POSITION.test(endText)) return 'malformed';
    end = Math.min(Number(endText), size - 1);
  }

  return start <= end && start < size ? { start, end } : 'unsatisfiable';
}

/**
 * Parses a `Range` header against a representation's `size`, into the bytes to serve.
 * Handles the three forms: `bytes=start-end`, `bytes=start-` (to the end), and `bytes=-suffix` (last N).
 * Ends are clamped to the last byte; a suffix larger than the size yields the whole representation.
 *
 * A malformed set or a unit other than `bytes` returns `ignore`, so the caller serves the full `200`.
 * A syntactically valid set whose every range is out of bounds returns `unsatisfiable` for a `416`.
 *
 * @example
 * ```ts
 * parseRange('bytes=0-499', 1000)
 * // -> { type: 'satisfiable', ranges: [{ start: 0, end: 499 }] }
 *
 * parseRange('bytes=-200', 1000)
 * // -> { type: 'satisfiable', ranges: [{ start: 800, end: 999 }] }
 *
 * parseRange('bytes=9999-', 1000)
 * // -> { type: 'unsatisfiable' }
 *
 * parseRange('items=0-9', 1000)
 * // -> { type: 'ignore' }
 * ```
 */
export function parseRange(header: string, size: number): RangeResult {
  const eq = header.indexOf('=');
  if (eq === -1 || header.slice(0, eq).trim() !== 'bytes') return { type: 'ignore' };

  const ranges: ByteRange[] = [];
  for (const spec of header.slice(eq + 1).split(',')) {
    const parsed = parseSpec(spec.trim(), size);
    if (parsed === 'malformed') return { type: 'ignore' };
    if (parsed !== 'unsatisfiable') ranges.push(parsed);
  }

  return ranges.length > 0 ? { type: 'satisfiable', ranges } : { type: 'unsatisfiable' };
}
