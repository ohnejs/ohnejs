import { last } from './last.ts';

/**
 * Options accepted by `next`.
 */
export interface NextOptions<T> {
  /**
   * The property to compare when the array items are objects.
   * If omitted, items are compared by identity.
   */
  prop?: keyof T;

  /**
   * Whether to loop back to the first item when the next step exceeds the array bounds.
   *
   * @default
   * false
   */
  loop?: boolean;

  /**
   * Whether to return the first array item when `current` cannot be found.
   *
   * @default
   * false
   */
  fallback?: boolean;
}

/**
 * Returns the item that follows `current` in `array`.
 * Without `loop`, the step clamps at the end: the item after the last one is the last one itself.
 * When `current` is not in the array, returns `undefined`, or the first item with `fallback`.
 *
 * @example
 * ```ts
 * next('bar', ['foo', 'bar', 'baz'])                                 // -> 'baz'
 * next({ id: 2 }, [{ id: 1 }, { id: 2 }, { id: 3 }], { prop: 'id' }) // -> { id: 3 }
 * next('bar', ['foo', 'bar'])                                        // -> 'bar'
 * next('bar', ['foo', 'bar'], { loop: true })                        // -> 'foo'
 * next('baz', ['foo', 'bar'])                                        // -> undefined
 * next('baz', ['foo', 'bar'], { fallback: true })                    // -> 'foo'
 * ```
 */
export function next<T>(
  current: T,
  array: readonly T[],
  options: NextOptions<T> = {},
): T | undefined {
  const { prop } = options;
  const index = prop
    ? array.findIndex((item) => item[prop] === current[prop])
    : array.indexOf(current);
  if (index === -1) return options.fallback ? array[0] : undefined;
  return options.loop ? array[(index + 1) % array.length] : (array[index + 1] ?? last(array));
}
