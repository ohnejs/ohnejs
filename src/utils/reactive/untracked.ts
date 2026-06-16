import { runWithEffect } from './_runtime.ts';

/**
 * Runs `fn` with no active effect.
 *
 * Reads of `Ref.value` or `ComputedRef.value` inside `fn` do NOT subscribe the outer effect.
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
  return runWithEffect(null, fn);
}
