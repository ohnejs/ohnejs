import { isArray } from '../is/is-array.ts';
import { isInteger } from '../is/is-integer.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * A single segment of a parsed dot-notation path.
 * `key` segments come from `.name` notation and address object properties.
 * `index` segments come from `[n]` notation and address array indices.
 */
export type DotNotationSegment =
  | {
      /**
       * Discriminator for object-key segments.
       */
      kind: 'key';

      /**
       * The object property name.
       */
      value: string;
    }
  | {
      /**
       * Discriminator for array-index segments.
       */
      kind: 'index';

      /**
       * The array index.
       * Always a non-negative safe integer.
       */
      value: number;
    };

/**
 * Parses a dot-notation path into a flat list of segments.
 * Object access is `.key`; array access is `[n]`.
 * The first segment may omit a leading `.`.
 *
 * The grammar is strict.
 * Throws on empty paths, stray `.`, unbalanced brackets, or missing separators.
 * Indices must be non-negative safe integers in canonical form.
 * No leading zeros, no whitespace, no hex, no exponent.
 *
 * @example
 * ```ts
 * parseDotNotation('foo.bar[0]')
 * // -> [{ kind: 'key', value: 'foo' }, ..., { kind: 'index', value: 0 }]
 *
 * parseDotNotation('[0][1]')
 * // -> [{ kind: 'index', value: 0 }, { kind: 'index', value: 1 }]
 * ```
 */
export function parseDotNotation(path: string): DotNotationSegment[] {
  if (path === '') {
    throw new Error('Invalid path: empty');
  }

  const segments: DotNotationSegment[] = [];
  const n = path.length;
  let i = 0;
  let expectKey = false;

  while (i < n) {
    const c = path[i];

    if (c === '[') {
      i++;
      const start = i;
      while (i < n && path[i] !== ']') i++;
      if (i === n) {
        throw new Error(`Invalid path: unterminated "[" in "${path}"`);
      }
      const inside = path.slice(start, i);
      const num = Number(inside);
      if (inside.length === 0 || !isInteger(num) || num < 0 || String(num) !== inside) {
        throw new Error(
          `Invalid path: "[${inside}]" is not a non-negative integer index in "${path}"`,
        );
      }
      segments.push({ kind: 'index', value: num });
      i++;
      expectKey = false;
      continue;
    }

    if (c === '.') {
      if (segments.length === 0) {
        throw new Error(`Invalid path: leading "." in "${path}"`);
      }
      i++;
      if (i === n) {
        throw new Error(`Invalid path: trailing "." in "${path}"`);
      }
      const next = path[i];
      if (next === '.' || next === '[' || next === ']') {
        throw new Error(`Invalid path: empty key after "." in "${path}"`);
      }
      expectKey = true;
      continue;
    }

    if (c === ']') {
      throw new Error(`Invalid path: unmatched "]" in "${path}"`);
    }

    if (segments.length > 0 && !expectKey) {
      throw new Error(`Invalid path: expected "." or "[" before key at position ${i} in "${path}"`);
    }
    const start = i;
    while (i < n && path[i] !== '.' && path[i] !== '[' && path[i] !== ']') i++;
    segments.push({ kind: 'key', value: path.slice(start, i) });
    expectKey = false;
  }

  return segments;
}

/**
 * Whether `value` is the container kind `segment` addresses.
 * A `key` segment addresses a plain object; an `index` segment addresses an array.
 * This is the shared resolution rule of `dotGet`, `dotHas`, and `dotUnset`.
 *
 * @example
 * ```ts
 * segmentAddresses({ kind: 'key', value: 'a' }, { a: 1 }) // -> true
 * segmentAddresses({ kind: 'key', value: 'a' }, [1, 2])   // -> false
 * segmentAddresses({ kind: 'index', value: 0 }, [1, 2])   // -> true
 * ```
 */
export function segmentAddresses(
  segment: DotNotationSegment,
  value: unknown,
): value is Record<string, unknown> | readonly unknown[] {
  return segment.kind === 'index' ? isArray(value) : isPlainObject(value);
}
