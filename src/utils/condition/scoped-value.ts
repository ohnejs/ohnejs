import { last } from '../array/last.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { conditionResolver } from './resolve-condition.ts';

/**
 * Reads a field path, as `parseFieldPath` splits it, through a stack of value scopes, outermost first.
 * A bare path reads the innermost scope, each `..` climbs one level, and a leading `/` reads the outermost.
 *
 * @example
 * ```ts
 * const scopes = [{ title: 'Guide' }, { label: 'Step 1' }]
 *
 * scopedValue(scopes, ['label'])        // -> 'Step 1'
 * scopedValue(scopes, ['..', 'title'])  // -> 'Guide'
 * scopedValue([], ['title'])            // -> undefined
 * ```
 */
export function scopedValue(
  scopes: readonly Readonly<Record<string, unknown>>[],
  path: readonly string[],
): unknown {
  const scope = last(scopes);
  return isUndefined(scope) ? undefined : conditionResolver(scope, scopes.slice(0, -1))(path);
}
