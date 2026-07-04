/**
 * A union of the known literals `T` that still accepts any other `Base` value.
 * Editors suggest the members of `T`; assignment stays open to the whole `Base` type.
 *
 * The `Base & Record<never, never>` intersection is what keeps the suggestions.
 * It stays assignable to `Base`, yet is distinct enough that `T`'s literals survive the union.
 * A plain `Base & {}` does not survive: through a generic alias it reduces back to `Base`.
 *
 * @example
 * ```ts
 * type Color = LiteralUnion<'red' | 'green'>
 *
 * const a: Color = 'red'    // suggested, still just a string
 * const b: Color = 'yellow' // allowed, no suggestion
 * ```
 */
export type LiteralUnion<T extends Base, Base = string> = T | (Base & Record<never, never>);
