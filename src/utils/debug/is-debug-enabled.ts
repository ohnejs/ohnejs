import { coerceToBoolean } from '../coerce/coerce-to-boolean.ts';
import { isString } from '../is/is-string.ts';

/**
 * Decides whether `namespace` is enabled by a `DEBUG`-style filter `pattern`.
 *
 * `pattern` is typically a raw env-var value (e.g. `process.env['DEBUG']`).
 *
 * Returns `true` when any of:
 * - `pattern` is booleanish-true (`1`, `true`, case-insensitive).
 * - A token in `pattern` is `*`.
 * - A token equals `namespace`.
 * - A token is `<x>:*` and `namespace` is `x` or starts with `x:`.
 *
 * Tokens are separated by commas and/or whitespace.
 * Namespace matching is case-sensitive.
 * Negation (`-foo`) is not supported.
 *
 * @example
 * ```ts
 * isDebugEnabled('app', '1')         // -> true
 * isDebugEnabled('app', '*')         // -> true
 * isDebugEnabled('app', 'app')       // -> true
 * isDebugEnabled('app', 'app:*')     // -> true
 * isDebugEnabled('app:db', 'app:*')  // -> true
 * isDebugEnabled('app', 'express:*') // -> false
 * isDebugEnabled('app', 'false')     // -> false
 * isDebugEnabled('app', undefined)   // -> false
 * ```
 */
export function isDebugEnabled(namespace: string, pattern: string | undefined): boolean {
  if (!isString(pattern)) return false;
  if (coerceToBoolean(pattern) === true) return true;

  for (const token of pattern.split(/[\s,]+/)) {
    if (token.length === 0) continue;
    if (token === '*' || token === namespace) return true;
    if (token.endsWith(':*')) {
      const prefix = token.slice(0, -2);
      if (namespace === prefix || namespace.startsWith(prefix + ':')) return true;
    }
  }

  return false;
}
