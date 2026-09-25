import { isUndefined } from '../is/is-undefined.ts';
import { hasKey } from '../object/has-key.ts';

/**
 * Why `fetchPublic` failed.
 *
 * - `invalid`: the input URL is unparseable, not `http:` or `https:`, or carries userinfo.
 * - `refused`: a destination is not admitted, or a response is unsafe to read.
 * - `redirects`: the redirect chain is too long.
 * - `unreachable`: DNS, connect, TLS, or the exchange failed, or the body was cut short.
 * - `status`: the final response is not a `200`.
 * - `tooLarge`: the body exceeds `maxBytes`, declared or counted.
 * - `timeout`: a deadline passed.
 * - `aborted`: the caller's signal aborted.
 */
export type FetchPublicErrorCode =
  | 'invalid'
  | 'refused'
  | 'redirects'
  | 'unreachable'
  | 'status'
  | 'tooLarge'
  | 'timeout'
  | 'aborted';

/**
 * A `fetchPublic` failure.
 * Its message is fixed per `code` and never names a URL, host, or address, so it is safe to show.
 * It carries no `cause`: a Node error can hold the input URL, credentials included.
 */
export interface FetchPublicError extends Error {
  /**
   * What failed.
   */
  code: FetchPublicErrorCode;

  /**
   * The final response's status, set for `status`.
   */
  status?: number;
}

const FETCH_PUBLIC_ERROR = Symbol('fetchPublic.error');

const MESSAGES: Record<FetchPublicErrorCode, string> = {
  invalid: 'Invalid URL',
  refused: 'Destination or response refused',
  redirects: 'Too many redirects',
  unreachable: 'Destination unreachable',
  status: 'Unexpected response status',
  tooLarge: 'Response too large',
  timeout: 'Request timed out',
  aborted: 'Request aborted',
};

/**
 * Builds the branded `Error` for a `fetchPublic` failure, with the fixed message for `code`.
 *
 * @example
 * ```ts
 * fetchPublicError('refused').message    // -> 'Destination or response refused'
 * fetchPublicError('status', 404).status // -> 404
 * ```
 */
export function fetchPublicError(code: FetchPublicErrorCode, status?: number): FetchPublicError {
  const error = new Error(MESSAGES[code]) as FetchPublicError;
  Object.defineProperty(error, FETCH_PUBLIC_ERROR, { value: true });
  error.code = code;
  if (!isUndefined(status)) error.status = status;
  return error;
}

/**
 * Whether `value` is a `fetchPublic` failure.
 *
 * @example
 * ```ts
 * isFetchPublicError(fetchPublicError('timeout')) // -> true
 * isFetchPublicError(new Error('timeout'))        // -> false
 * ```
 */
export function isFetchPublicError(value: unknown): value is FetchPublicError {
  return value instanceof Error && hasKey(value, FETCH_PUBLIC_ERROR);
}
