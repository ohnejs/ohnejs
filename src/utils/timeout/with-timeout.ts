/**
 * Races a promise against a millisecond deadline.
 *
 * Resolves with the promise's value if it settles first, clearing the timer.
 * If the deadline passes first, resolves with `onTimeout()` instead.
 * The original promise keeps running, but its later settling is ignored, so a rejection cannot leak.
 * A rejection that beats the deadline still rejects the returned promise.
 *
 * @example
 * ```ts
 * await withTimeout(fetchUser(), 1000, () => null) // -> user, or null after 1s
 * await withTimeout(slow(), 50, () => 'fallback')  // -> 'fallback'
 * ```
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
