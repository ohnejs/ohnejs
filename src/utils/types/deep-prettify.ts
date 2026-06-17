/**
 * Flattens a type for display, collapsing intersections into a single object literal.
 * Recurses into nested objects; arrays, functions, and other values pass through unchanged.
 * Purely cosmetic - the result is structurally identical to `T`.
 *
 * @example
 * ```ts
 * type Messy = { a: string } & { b: number }
 * type Clean = DeepPrettify<Messy> // -> { a: string; b: number }
 * ```
 */
export type DeepPrettify<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: DeepPrettify<T[K]> }
      : T;
