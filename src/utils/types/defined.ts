/**
 * Strips `undefined` from `T`.
 *
 * @example
 * ```ts
 * type A = Defined<string | undefined>        // -> string
 * type B = Defined<string | null | undefined> // -> string | null
 * ```
 */
export type Defined<T> = Exclude<T, undefined>;
