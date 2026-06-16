import { cleanup, type Effect, runWithEffect, track, trigger } from './_runtime.ts';

/**
 * Lazy, cached derivation.
 * The result is determined by the getter passed to `computed` - the `.value` is read-only.
 */
export interface ComputedRef<T> {
  /**
   * The current value.
   * Re-evaluates the getter if any tracked dependency has changed since the last read.
   */
  readonly value: T;
}

/**
 * Creates a lazy, cached derivation.
 *
 * The getter runs on the first `.value` read and caches the result.
 * It re-runs only when one of its tracked dependencies changes.
 * Reads inside an `effect` or another `computed` subscribe to it.
 *
 * @example
 * ```ts
 * const a = ref(1)
 * const b = ref(2)
 * const sum = computed(() => a.value + b.value)
 *
 * sum.value     // -> 3
 * a.value = 10
 * sum.value     // -> 12 (re-evaluated)
 * sum.value     // -> 12 (cached, no re-run)
 * ```
 */
export function computed<T>(getter: () => T): ComputedRef<T> {
  let cached!: T;
  let dirty = true;
  let evaluating = false;
  const subs = new Set<Effect>();

  const runner: Effect = {
    fn: () => {
      cached = getter();
    },
    scheduler() {
      dirty = true;
      trigger(subs);
    },
    deps: new Set(),
    active: true,
  };

  return {
    get value() {
      if (evaluating) throw new Error('Cyclic computed');
      track(subs);
      if (dirty) {
        evaluating = true;
        try {
          cleanup(runner);
          cached = runWithEffect(runner, getter);
          dirty = false;
        } finally {
          evaluating = false;
        }
      }
      return cached;
    },
  };
}
