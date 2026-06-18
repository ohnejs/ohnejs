import { isSet } from '../is/is-set.ts';

/**
 * Returns `base` if it is not in `taken`; otherwise appends `-2`, `-3`, ... until a free name is found.
 * Does not mutate `taken`.
 * Throws when `base` is empty.
 *
 * If `base` already ends with `-N`, the suffix is peeled and incremented.
 * This avoids `foo-2-2`-style chains across calls.
 *
 * Pass a `Set` for O(1) membership checks, or any read-only array for ergonomics.
 *
 * @example
 * ```ts
 * uniqueName('foo', new Set())                 // -> 'foo'
 * uniqueName('foo', new Set(['foo']))          // -> 'foo-2'
 * uniqueName('foo', new Set(['foo', 'foo-2'])) // -> 'foo-3'
 * uniqueName('foo', ['foo', 'foo-2', 'foo-3']) // -> 'foo-4'
 * uniqueName('foo-2', new Set(['foo-2']))      // -> 'foo-3' (suffix peeled)
 * ```
 */
export function uniqueName(base: string, taken: ReadonlySet<string> | readonly string[]): string {
  if (base.length === 0) {
    throw new Error('Invalid base: empty');
  }

  const takenSet: ReadonlySet<string> = isSet<Set<string>>(taken) ? taken : new Set(taken);
  if (!takenSet.has(base)) return base;

  let root = base;
  let suffix = 2;
  const match = /^(.+)-(\d+)$/.exec(base);
  if (match) {
    root = match[1]!;
    suffix = parseInt(match[2]!, 10) + 1;
  }

  while (takenSet.has(`${root}-${suffix}`)) suffix++;
  return `${root}-${suffix}`;
}
