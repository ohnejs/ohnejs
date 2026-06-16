import { cleanup, type Effect, runEffect } from './_runtime.ts';

/**
 * Runs `fn` immediately and again whenever a tracked dependency changes.
 *
 * Reads of `Ref.value` or `ComputedRef.value` inside `fn` are tracked as dependencies.
 * On every re-run, stale dependencies are detached so they no longer trigger the effect.
 * The returned function stops the effect and detaches it from every current dependency.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * const stop = effect(() => console.log(count.value))  // logs 0
 *
 * count.value = 1   // logs 1
 * stop()
 * count.value = 2   // nothing logged
 * ```
 */
export function effect(fn: () => void): () => void {
  const e: Effect = {
    fn,
    deps: new Set(),
    active: true,
  };
  runEffect(e);
  return () => {
    if (!e.active) return;
    e.active = false;
    cleanup(e);
  };
}
