/**
 * Why a value fails a shared check: a `validation.*` message key, or the key with its parameters.
 * A bare key is the whole message; the object form interpolates `params` into the key's template.
 * The keys live in the base `validation` catalog, so the server and the dashboard word a failure alike.
 *
 * @example
 * ```ts
 * const empty: ValidationFailure = 'validation.emptyValue'
 * const short: ValidationFailure = { key: 'validation.minLength', params: { min: 3 } }
 * ```
 */
export type ValidationFailure =
  | `validation.${string}`
  | {
      /**
       * The message key.
       */
      key: `validation.${string}`;

      /**
       * The values the key's template interpolates.
       */
      params: Record<string, unknown>;
    };

/**
 * The inclusive bounds a shared check compares against; an omitted bound never fails.
 *
 * @example
 * ```ts
 * const bounds: ValidationBounds = { min: 1, max: 10 }
 * ```
 */
export interface ValidationBounds<T = number> {
  /**
   * The smallest legal measure.
   */
  readonly min?: T | undefined;

  /**
   * The largest legal measure.
   */
  readonly max?: T | undefined;
}
