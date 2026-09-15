/**
 * Outcome of a `measure` call.
 */
export interface Measured<T> {
  /**
   * The value the measured function returned (awaited if it was a promise).
   */
  result: T;

  /**
   * Wall-clock time the function took, in milliseconds.
   * Sourced from `performance.now()`, so it is monotonic and sub-millisecond precise.
   */
  ms: number;
}

/**
 * Runs `fn` and reports how long it took.
 *
 * Works with sync or async functions; the returned promise resolves once `fn` settles.
 * Pairs with `formatDuration` to turn the raw `ms` into a human-readable string.
 *
 * A throw from `fn` propagates unchanged, so nothing is timed on the failure path.
 *
 * @example
 * ```ts
 * const { result, ms } = await measure(() => fetch(url))
 * formatDuration(ms) // -> '1s 200ms'
 * ```
 */
export async function measure<T>(fn: () => Promise<T> | T): Promise<Measured<T>> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}
