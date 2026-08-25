/**
 * Options accepted by `prev`.
 */
export interface PrevOptions<T> {
  /**
   * The property to compare when the array items are objects.
   * If omitted, items are compared by identity.
   */
  prop?: keyof T;

  /**
   * Whether to loop back to the last item when the previous step exceeds the array bounds.
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
 * Returns the item that precedes `current` in `array`.
 * Without `loop`, the step clamps at the start: the item before the first one is the first one itself.
 * When `current` is not in the array, returns `undefined`, or the first item with `fallback`.
 *
 * @example
 * ```ts
 * prev('bar', ['foo', 'bar', 'baz'])                                 // -> 'foo'
 * prev({ id: 2 }, [{ id: 1 }, { id: 2 }, { id: 3 }], { prop: 'id' }) // -> { id: 1 }
 * prev('foo', ['foo', 'bar'])                                        // -> 'foo'
 * prev('foo', ['foo', 'bar'], { loop: true })                        // -> 'bar'
 * prev('baz', ['foo', 'bar'])                                        // -> undefined
 * prev('baz', ['foo', 'bar'], { fallback: true })                    // -> 'foo'
 * ```
 */
export function prev<T>(
  current: T,
  array: readonly T[],
  options: PrevOptions<T> = {},
): T | undefined {
  const { prop } = options;
  const index = prop
    ? array.findIndex((item) => item[prop] === current[prop])
    : array.indexOf(current);
  if (index === -1) return options.fallback ? array[0] : undefined;
  return options.loop
    ? array[(index - 1 + array.length) % array.length]
    : (array[index - 1] ?? array[0]);
}
