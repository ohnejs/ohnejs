/**
 * A value decoded from a search-param string.
 * The JSON value model: string, number, boolean, `null`, and arrays/objects nested freely.
 */
export type SearchParamValue =
  | string
  | number
  | boolean
  | null
  | SearchParamValue[]
  | { [key: string]: SearchParamValue };

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const INTEGER = /^-?(?:0|[1-9]\d*)$/;

/**
 * Coerces one decoded token to its `SearchParamValue`.
 * `true`/`false`/`null` map to those literals; JSON-shaped numbers map to numbers.
 * Anything else stays a string, so `007`, `+5`, and `.5` keep their text.
 * Integers past the safe range stay strings too, so large ids keep every digit.
 *
 * @example
 * ```ts
 * coerceToken('42')    // -> 42
 * coerceToken('1.5e3') // -> 1500
 * coerceToken('true')  // -> true
 * coerceToken('007')   // -> '007'
 * coerceToken('hi')    // -> 'hi'
 * ```
 */
export function coerceToken(token: string): SearchParamValue {
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  if (NUMBER.test(token)) {
    const n = Number(token);
    if (INTEGER.test(token) && !Number.isSafeInteger(n)) return token;
    return n;
  }
  return token;
}
