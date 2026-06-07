/**
 * Checks whether a value is a `Date` with a valid time (excludes Invalid Date).
 *
 * @example
 * ```ts
 * isDate(new Date())             // -> true
 * isDate(new Date('not a date')) // -> false
 * isDate('2024-01-01')           // -> false
 * ```
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
