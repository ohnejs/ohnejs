import { isUndefined } from '../is/is-undefined.ts';
import { dotSet } from './dot-set.ts';

/**
 * Inverse of `dotFlatten`.
 * Builds a nested structure from a flat map of dot/bracket paths.
 * Each entry is applied via `dotSet`; later keys can override or extend earlier branches.
 *
 * The root is inferred from the first key's first segment: a leading `[n]` produces an array, otherwise an object.
 * An empty input returns `{}`.
 *
 * @example
 * ```ts
 * dotUnflatten({ 'a.b': 1, 'a.c[0]': 2, 'a.c[1]': 3 })
 * // -> { a: { b: 1, c: [2, 3] } }
 *
 * dotUnflatten({ '[0]': 'x', '[1]': 'y' })
 * // -> ['x', 'y']
 *
 * dotUnflatten({})
 * // -> {}
 * ```
 */
export function dotUnflatten(flat: Record<string, unknown>): Record<string, unknown> | unknown[] {
  let result: Record<string, unknown> | unknown[] | undefined;
  let rootIsArray: boolean | undefined;
  for (const key of Object.keys(flat)) {
    const keyIsArrayRoot = key.startsWith('[');
    if (isUndefined(rootIsArray)) {
      rootIsArray = keyIsArrayRoot;
    } else if (rootIsArray !== keyIsArrayRoot) {
      throw new Error(
        `dotUnflatten: key "${key}" implies a different root type than the first key`,
      );
    }
    result = dotSet(result as Record<string, unknown> | unknown[], key, flat[key]);
  }
  return result ?? {};
}
