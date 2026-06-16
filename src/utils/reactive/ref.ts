import { type Effect, track, trigger } from './_runtime.ts';

/**
 * Reactive value container.
 * Reads of `.value` inside an `effect` or `computed` subscribe to it.
 * Writes that change the value (per `Object.is`) notify every subscriber.
 */
export interface Ref<T> {
  /**
   * The current value.
   * Reading subscribes the active effect; writing an `Object.is`-different value triggers subscribers.
   */
  value: T;
}

/**
 * Creates a reactive value container.
 *
 * Reads of `.value` inside an `effect` or `computed` subscribe to the ref.
 * Writes that change the value (per `Object.is`) notify every subscriber; equal writes are no-ops.
 *
 * @example
 * ```ts
 * const count = ref(0)
 *
 * effect(() => console.log(count.value))  // logs 0
 * count.value = 1                         // logs 1
 * count.value = 1                         // no-op (Object.is equal)
 * ```
 */
export function ref<T>(initial: T): Ref<T> {
  let current = initial;
  const subs = new Set<Effect>();
  return {
    get value() {
      track(subs);
      return current;
    },
    set value(next) {
      if (Object.is(next, current)) return;
      current = next;
      trigger(subs);
    },
  };
}
