import type { Message } from '../../messages/known-messages.ts';

import { hasKey } from '../../../utils/index.ts';

/**
 * A write's field failures, keyed by dot-path.
 *
 * Every value is a `Message`: a param-free key, a `{ key, params }` object, or a plain string.
 * Translation is deferred, so a consumer resolves each message in its own language at the boundary.
 * A key is the field's path from the record root: `title`, `sections[2].heading`, `author`.
 */
export type FieldErrors = { [path: string]: Message };

const VALIDATION_ERROR = Symbol('ohne.validationError');

const REFERENCE_VIOLATION = Symbol('ohne.referenceViolation');

/**
 * The error an `*OrThrow` write raises, carrying the same field-error map the result form returns.
 */
export interface ValidationError extends Error {
  /**
   * The field failures, keyed by dot-path; every value a `Message` resolved at the boundary.
   */
  errors: FieldErrors;
}

/**
 * Builds the branded error an `*OrThrow` write throws when validation fails.
 *
 * It carries the `errors` map verbatim, so a caller catching it reads the same paths a result would.
 * The message names the failing paths, so an uncaught throw still reads at a glance.
 *
 * @example
 * ```ts
 * throw validationError({ title: 'This field is required' })
 * ```
 */
export function validationError(errors: FieldErrors): ValidationError {
  const error = new Error(
    `Validation failed: ${Object.keys(errors).join(', ')}`,
  ) as ValidationError;
  error.name = 'ValidationError';
  Object.defineProperty(error, VALIDATION_ERROR, { value: true });
  error.errors = errors;
  return error;
}

/**
 * Whether `value` is the error a write throws when its input fails validation, as `createOrThrow` does.
 * Its `errors` maps each failing field path to a message, the same map a failed `create` returns.
 *
 * @example
 * ```ts
 * try {
 *   await query('Posts').createOrThrow({ title: 'Hello' })
 * } catch (error) {
 *   if (!isValidationError(error)) throw error
 *   error.errors // -> { body: 'validation.required' }
 * }
 * ```
 */
export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof Error && hasKey(value, VALIDATION_ERROR);
}

/**
 * The error a `delete` raises when another record's `restrict` reference still points at a matched row.
 *
 * It carries the driver failure as its `cause`, so the classification stays inspectable under `DEBUG`.
 * The HTTP seam maps it to a `409`, since the delete conflicts with a row that depends on the target.
 *
 * @example
 * ```ts
 * if (dialect.isForeignKeyViolation(error)) throw referenceViolation(error)
 * ```
 */
export function referenceViolation(cause?: unknown): Error {
  const error = new Error('A referenced record blocks this delete', { cause });
  error.name = 'ReferenceViolation';
  Object.defineProperty(error, REFERENCE_VIOLATION, { value: true });
  return error;
}

/**
 * Whether `value` is the error a `delete` throws when a `restrict` reference still points at a record.
 *
 * @example
 * ```ts
 * try {
 *   await query('Authors').where('UUID', uuid).delete()
 * } catch (error) {
 *   if (!isReferenceViolation(error)) throw error
 *   console.warn('A post still references this author')
 * }
 * ```
 */
export function isReferenceViolation(value: unknown): value is Error {
  return value instanceof Error && hasKey(value, REFERENCE_VIOLATION);
}
