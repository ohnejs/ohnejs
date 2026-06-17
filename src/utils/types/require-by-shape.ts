import type { Defined } from './defined.ts';

/**
 * Keys of `Shape` whose marker is a nested shape to recurse into.
 */
type NestedKeys<Shape> = { [K in keyof Shape]: Shape[K] extends object ? K : never }[keyof Shape];

/**
 * Makes every key present in `Shape` required on `T`, recursing into nested shapes.
 * A non-object leaf (e.g. `true`) requires that key; nested objects recurse into it.
 * Keys of `T` absent from `Shape` keep their original optionality.
 * Only `undefined` (optionality) is removed, so a declared `null` survives.
 *
 * Every shaped key is required via `Required<Pick>` so its JSDoc carries through.
 * Nested keys are then deepened by intersection, which keeps the documented constituent.
 *
 * @example
 * ```ts
 * type T = { a?: string; b?: { c?: number } }
 *
 * type R = RequireByShape<T, { b: { c: true } }>
 * // -> { a?: string } & { b: { c: number } }
 * ```
 */
export type RequireByShape<T, Shape> = Omit<T, keyof Shape> &
  Required<Pick<T, keyof Shape & keyof T>> & {
    [K in NestedKeys<Shape> & keyof T]: RequireByShape<Defined<T[K]>, Shape[K]>;
  };
