/**
 * Extracts a human-readable message from an unknown thrown value.
 * Returns an `Error`'s `message`, otherwise the value coerced with `String`.
 * An `AggregateError` without a message of its own joins the messages of the errors it carries.
 *
 * @example
 * ```ts
 * errorMessage(new Error('boom')) // -> 'boom'
 * errorMessage('boom')            // -> 'boom'
 * errorMessage(42)                // -> '42'
 * ```
 */
export function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.message === '') {
    return error.errors.map(errorMessage).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
