/**
 * A debounced function with a `cancel` method.
 */
export interface Debounced<A extends unknown[]> {
  /**
   * Schedules `fn` to run after the delay, replacing any pending run.
   */
  (...args: A): void;

  /**
   * Clears a pending run without invoking `fn`.
   */
  cancel(): void;
}

/**
 * Wraps `fn` so a burst of calls collapses into one trailing call.
 * Each call restarts the timer; `fn` runs `ms` after the last call in the burst.
 * Only the most recent call's arguments reach `fn`.
 *
 * `cancel` drops a pending run, e.g. on teardown so a stray timer cannot fire.
 *
 * @example
 * ```ts
 * const save = debounce(persist, 200)
 *
 * save()
 * save()
 * save() // persist runs once, 200ms after the last call
 *
 * const flush = debounce(rebuild, 100)
 *
 * flush()
 * flush.cancel() // nothing runs
 * ```
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Object.assign(
    (...args: A): void => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    },
    {
      cancel(): void {
        clearTimeout(timer);
        timer = undefined;
      },
    },
  );
}
