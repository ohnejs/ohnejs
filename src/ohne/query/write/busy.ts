import { hasKey } from '../../../utils/index.ts';

const BUSY_ERROR = Symbol('ohne.busyError');

/**
 * The retryable error a write raises when the database is held busy by another connection.
 *
 * The HTTP layer renders it as `503` with a `Retry-After`, since the write can simply be retried.
 */
export interface BusyError extends Error {}

/**
 * Builds the branded retryable error a busy database surfaces.
 *
 * Pass the driver error as `cause`, so `DEBUG` still shows the underlying failure.
 *
 * @example
 * ```ts
 * if (dialect.isBusy(caught)) throw busyError(caught)
 * ```
 */
export function busyError(cause?: unknown): BusyError {
  const error = new Error('Database is busy, retry the write', { cause }) as BusyError;
  Object.defineProperty(error, BUSY_ERROR, { value: true });
  return error;
}

/**
 * Whether `value` is the retryable error a write throws while another connection keeps the database busy.
 * An HTTP handler answers it with a `503` on its own; a script or job retries the write itself.
 *
 * @example
 * ```ts
 * try {
 *   await query('Posts').create({ title: 'Hello' })
 * } catch (error) {
 *   if (!isBusyError(error)) throw error
 *   await query('Posts').create({ title: 'Hello' })
 * }
 * ```
 */
export function isBusyError(value: unknown): value is BusyError {
  return value instanceof Error && hasKey(value, BUSY_ERROR);
}
