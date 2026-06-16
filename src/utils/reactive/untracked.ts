import { runUntracked } from './_runtime.ts';

/**
 * Runs `fn` with reactive tracking suspended.
 *
 * Reads of `Ref.value` or `ComputedRef.value` inside `fn` do NOT subscribe the outer effect.
 * Writes still trigger subscribers as usual.
 * The outer effect is not re-triggered by its own self-write inside `fn`.
 * Returns whatever `fn` returns.
 *
 * @example
 * ```ts
 * const count = ref(0)
 *
 * effect(() => {
 *   const seed = untracked(() => count.value)  // not tracked
 *   console.log(seed)
 * })
 *
 * count.value = 1   // effect does NOT re-run
 * ```
 */
export function untracked<T>(fn: () => T): T {
  return runUntracked(fn);
}
