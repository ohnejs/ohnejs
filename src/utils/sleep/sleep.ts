import { parseDuration } from '../duration/parse-duration.ts';
import { longTimeout } from '../timeout/long-timeout.ts';

/**
 * Options for `sleep`.
 */
export interface SleepOptions {
  /**
   * Cuts the wait short: once it aborts, the sleep rejects with its `reason`.
   */
  signal?: AbortSignal;
}

/**
 * Returns a promise that resolves after the given delay.
 * Accepts a number of milliseconds or any string `parseDuration` understands.
 * Aborting `signal`, before or during the wait, rejects it with the signal's `reason` and clears the timer.
 *
 * @example
 * ```ts
 * await sleep(100)              // pauses for 100ms
 * await sleep('1.5s')           // pauses for 1500ms
 * await sleep('1h')             // pauses for one hour
 * await sleep('1h', { signal }) // pauses until the hour passes or `signal` aborts
 * ```
 */
export function sleep(duration: number | string, options: SleepOptions = {}): Promise<void> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = (): void => {
      cancel();
      reject(signal?.reason);
    };
    const cancel = longTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, parseDuration(duration));
    signal?.addEventListener('abort', abort, { once: true });
  });
}
