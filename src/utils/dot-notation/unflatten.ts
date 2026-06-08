import { isUndefined } from '../is/is-undefined.ts';
import { set } from './set.ts';

/**
 * Inverse of `flatten`.
 * Builds a nested structure from a flat map of dot/bracket paths.
 * Each entry is applied via `set`; later keys can override or extend earlier branches.
 *
 * The root is inferred from the first key's first segment: a leading `[n]` produces an array, otherwise an object.
 * An empty input returns `{}`.
 *
 * @example
 * ```ts
 * unflatten({ 'a.b': 1, 'a.c[0]': 2, 'a.c[1]': 3 })
 * // -> { a: { b: 1, c: [2, 3] } }
 *
 * unflatten({ '[0]': 'x', '[1]': 'y' })
 * // -> ['x', 'y']
 *
 * unflatten({})
 * // -> {}
 * ```
 */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> | unknown[] {
  let result: Record<string, unknown> | unknown[] | undefined;
  let rootIsArray: boolean | undefined;
  for (const key of Object.keys(flat)) {
    const keyIsArrayRoot = key.startsWith('[');
    if (isUndefined(rootIsArray)) {
      rootIsArray = keyIsArrayRoot;
    } else if (rootIsArray !== keyIsArrayRoot) {
      throw new Error(`unflatten: key "${key}" implies a different root type than the first key`);
    }
    result = set(result as Record<string, unknown> | unknown[], key, flat[key]);
  }
  return result ?? {};
}
