import { parseDuration } from '../duration/parse-duration.ts';

/**
 * Returns a promise that resolves after the given delay.
 * Accepts a number of milliseconds or any string `parseDuration` understands.
 *
 * @example
 * ```ts
 * await sleep(100)    // pauses for 100ms
 * await sleep('1.5s') // pauses for 1500ms
 * await sleep('1h')   // pauses for one hour
 * ```
 */
export function sleep(duration: number | string): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, parseDuration(duration)));
}
