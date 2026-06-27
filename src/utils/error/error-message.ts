/**
 * Extracts a human-readable message from an unknown thrown value.
 * Returns an `Error`'s `message`, otherwise the value coerced with `String`.
 *
 * @example
 * ```ts
 * errorMessage(new Error('boom')) // -> 'boom'
 * errorMessage('boom')            // -> 'boom'
 * errorMessage(42)                // -> '42'
 * ```
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
