import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * The values inside a JSON container, or `undefined` when `value` is no container JSON keeps whole.
 * An array must be dense with no extra keys, and an object a plain one with only enumerable string keys.
 */
export function jsonChildren(value: unknown): readonly unknown[] | undefined {
  if (isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return undefined;
    }
    return Reflect.ownKeys(value).length === value.length + 1 ? value : undefined;
  }
  if (isPlainObject(value)) {
    const values = Object.values(value);
    return Reflect.ownKeys(value).length === values.length ? values : undefined;
  }
  return undefined;
}
