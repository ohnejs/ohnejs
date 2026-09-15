/**
 * A FIFO async lock: it runs one task at a time, in the order the tasks were handed to it.
 */
export type Mutex = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Creates a FIFO async lock that serializes the tasks handed to it.
 *
 * Each call chains after the previous task settles, so at most one task runs at a time.
 * The chain never poisons: a rejected task rejects to its own caller, and the next task still runs.
 * Reach for it to guard a resource that cannot overlap - a single connection's transactions, say.
 *
 * @example
 * ```ts
 * const lock = createMutex()
 * lock(() => step('a')) // -> runs first
 * lock(() => step('b')) // -> waits for `a` to settle, then runs
 * ```
 */
export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
