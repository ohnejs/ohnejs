import { isString } from '../is/is-string.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks whether a value is a `UUID` in its 36-character hyphenated form, hex in either case.
 * Any version passes, since only the shape is checked.
 *
 * @example
 * ```ts
 * isUUID('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b') // -> true
 * isUUID('019F3C1A-8B2D-7F4E-9A6B-1C2D3E4F5A6B') // -> true
 * isUUID('019f3c1a8b2d7f4e9a6b1c2d3e4f5a6b')     // -> false
 * isUUID('../admin')                             // -> false
 * ```
 */
export function isUUID(value: unknown): value is string {
  return isString(value) && UUID.test(value);
}
