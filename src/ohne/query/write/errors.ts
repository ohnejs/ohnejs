import type { Message } from '../../messages/known-messages.ts';

import { hasKey } from '../../../utils/index.ts';

/**
 * A write's field failures, keyed by dot-path.
 *
 * Every value is a `Message`: a param-free key, a `[key, params]` tuple, or a plain string.
 * Translation is deferred, so a consumer resolves each message in its own language at the boundary.
 * A key is the field's path from the record root: `title`, `sections[2].heading`, `author`.
 */
export type FieldErrors = { [path: string]: Message };

const VALIDATION_ERROR = Symbol('ohne.validationError');

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
  Object.defineProperty(error, VALIDATION_ERROR, { value: true });
  error.errors = errors;
  return error;
}

/**
 * Whether `value` is a `validationError`.
 *
 * @example
 * ```ts
 * isValidationError(validationError({ title: 'required' })) // -> true
 * isValidationError(new Error('x'))                         // -> false
 * ```
 */
export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof Error && hasKey(value, VALIDATION_ERROR);
}
