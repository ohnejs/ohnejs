import { isSafeMethod } from './is-safe-method.ts';

const IDEMPOTENT_METHODS = new Set(['PUT', 'DELETE']);

/**
 * Reports whether an HTTP method is idempotent per RFC 9110: repeating it has the same effect as once.
 * The idempotent methods are the safe ones plus `PUT` and `DELETE`; `POST` and `PATCH` are not.
 *
 * Method names are case-sensitive, matching the uppercase form a Web `Request` normalizes to.
 *
 * @example
 * ```ts
 * isIdempotentMethod('PUT')  // -> true
 * isIdempotentMethod('POST') // -> false
 * ```
 */
export function isIdempotentMethod(method: string): boolean {
  return isSafeMethod(method) || IDEMPOTENT_METHODS.has(method);
}
