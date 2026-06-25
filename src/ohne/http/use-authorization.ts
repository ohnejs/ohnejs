import { type Authorization, isNull, parseAuthorization } from '../../utils/index.ts';
import { useRequest } from './use-request.ts';

/**
 * Returns the request's parsed `Authorization` header, or `null` when it is absent or empty.
 * Shorthand for `parseAuthorization(useRequest().headers.get('authorization'))`.
 * Valid only within a request.
 *
 * @example
 * ```ts
 * // Authorization: Bearer abc.def
 * useAuthorization() // -> { scheme: 'bearer', token: 'abc.def' }
 * ```
 */
export function useAuthorization(): Authorization | null {
  const header = useRequest().headers.get('authorization');
  return isNull(header) ? null : parseAuthorization(header);
}
