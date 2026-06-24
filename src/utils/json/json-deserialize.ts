import { isString } from '../is/is-string.ts';

/**
 * Reviver accepted by `jsonDeserialize`.
 * Same shape as the second argument of `JSON.parse`.
 * Called bottom-up for each key/value during parsing.
 */
export type JSONReviver = (this: unknown, key: string, value: unknown) => unknown;

/**
 * Deserializes a JSON string.
 * Non-string inputs are returned untouched.
 * Useful when a DB driver pre-parses the JSON.
 * Strings that fail to parse are returned as-is.
 * Soft coercion: never throws.
 *
 * @example
 * ```ts
 * jsonDeserialize<number[]>('[1,2,3]') // -> [1, 2, 3]
 * jsonDeserialize([1, 2, 3])           // -> [1, 2, 3]
 * jsonDeserialize('not-json')          // -> 'not-json'
 * ```
 */
export function jsonDeserialize<T = unknown>(value: unknown, reviver?: JSONReviver): T {
  if (!isString(value)) return value as T;
  try {
    return JSON.parse(value, reviver) as T;
  } catch {
    return value as T;
  }
}
