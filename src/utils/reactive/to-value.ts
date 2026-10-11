import { isFunction } from '../is/is-function.ts';

/**
 * A value given as is, or as a getter that reads it.
 * A getter read inside an effect subscribes it, so the value stays live.
 */
export type MaybeGetter<T> = T | (() => T);

/**
 * Reads a value that may be a getter: a getter is called, anything else is answered as is.
 * Inside an effect a getter's reads subscribe it, so the caller follows the value.
 *
 * @example
 * ```ts
 * const label = ref('Save')
 *
 * toValue('Close')           // -> 'Close'
 * toValue(() => label.value) // -> 'Save'
 * ```
 */
export function toValue<T>(source: MaybeGetter<T>): T {
  return isFunction<() => T>(source) ? source() : source;
}
