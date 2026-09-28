import { isArray } from '../is/is-array.ts';
import { isFunction } from '../is/is-function.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * Replacer accepted by `jsonSerialize`.
 * Same shape as the second argument of `JSON.stringify`.
 * Either a transform function, or a key allow-list.
 */
export type JSONReplacer =
  | ((this: unknown, key: string, value: unknown) => unknown)
  | (string | number)[];

/**
 * Copies `value` with plain-object keys sorted at every depth; arrays keep their element order.
 */
function sortKeys(value: unknown): unknown {
  if (isArray(value)) return value.map(sortKeys);

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return Object.fromEntries(keys.map((key) => [key, sortKeys(value[key])]));
  }

  return value;
}

/**
 * Serializes a value to a canonical JSON string.
 * Plain-object keys are sorted recursively.
 * Two equal values stringify identically regardless of insertion order.
 * Arrays preserve element order.
 *
 * Class instances (`Date`, `Map`, `Set`, ...) are passed through to `JSON.stringify` untouched.
 * For typed roundtrip use `composeCodecs`.
 *
 * @example
 * ```ts
 * jsonSerialize({ b: 2, a: 1 })   // -> '{"a":1,"b":2}'
 * jsonSerialize([{ b: 2, a: 1 }]) // -> '[{"a":1,"b":2}]'
 * jsonSerialize([3, 1, 2])        // -> '[3,1,2]'
 * ```
 */
export function jsonSerialize(value: unknown, replacer?: JSONReplacer): string {
  const sorted = sortKeys(value);
  if (isFunction<(this: unknown, key: string, value: unknown) => unknown>(replacer)) {
    return JSON.stringify(sorted, replacer);
  }
  return JSON.stringify(sorted, replacer);
}
