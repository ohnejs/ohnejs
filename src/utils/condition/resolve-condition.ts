import { isPlainObject } from '../is/is-plain-object.ts';
import { hasKey } from '../object/has-key.ts';

/**
 * Builds the path resolver `evaluateCondition` reads a scoped condition through.
 * A bare path reads `scope`; a leading `/` reads the outermost scope; each `..` climbs one level.
 * `ancestors` runs root-first, so `..` steps back through it; a climb past the root reads `undefined`.
 *
 * @example
 * ```ts
 * const resolve = conditionResolver({ city: 'Sarajevo' }, [{ kind: 'promo' }])
 *
 * resolve(['city'])          // -> 'Sarajevo'
 * resolve(['..', 'kind'])    // -> 'promo'
 * resolve(['/', 'kind'])     // -> 'promo'
 * resolve(['..', '..', 'x']) // -> undefined
 * ```
 */
export function conditionResolver(
  scope: Readonly<Record<string, unknown>>,
  ancestors: readonly Readonly<Record<string, unknown>>[],
): (path: readonly string[]) => unknown {
  const stack = [...ancestors, scope];
  return (segments) => {
    let index = stack.length - 1;
    let cursor = 0;
    if (segments[cursor] === '/') {
      index = 0;
      cursor += 1;
    }
    while (segments[cursor] === '..') {
      index -= 1;
      cursor += 1;
    }
    if (index < 0) return undefined;
    let value: unknown = stack[index];
    for (; cursor < segments.length; cursor += 1) {
      if (!isPlainObject(value)) return undefined;
      value = hasKey(value, segments[cursor]) ? value[segments[cursor]] : undefined;
    }
    return value;
  };
}
