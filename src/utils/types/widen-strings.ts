/**
 * Widens every string type in `T` to `string`, recursing into objects and arrays.
 * Other values, functions included, pass through unchanged.
 *
 * @example
 * ```ts
 * type Narrow = { locale?: 'de' | 'fr'; tags: 'a'[]; off: false }
 * type Wide = WidenStrings<Narrow> // -> { locale?: string; tags: string[]; off: false }
 * ```
 */
export type WidenStrings<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends string
    ? string
    : T extends object
      ? { [K in keyof T]: WidenStrings<T[K]> }
      : T;
