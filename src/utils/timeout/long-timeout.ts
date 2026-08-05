const MAX_DELAY = 2_147_483_647;

/**
 * `setTimeout` without the 32-bit wall: a delay past `2^31 - 1` ms chains timers instead of clamping.
 * The platform clamps an overflowing delay to `1` ms, firing a month-long timer almost immediately.
 * Returns a cancel function; cancelling is a no-op once the callback has run.
 *
 * @example
 * ```ts
 * const cancel = longTimeout(() => flush(), parseDuration('60d'))
 * cancel()
 * ```
 */
export function longTimeout(callback: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = (remaining: number): void => {
    timer =
      remaining > MAX_DELAY
        ? setTimeout(() => arm(remaining - MAX_DELAY), MAX_DELAY)
        : setTimeout(callback, remaining);
  };
  arm(ms);
  return () => clearTimeout(timer);
}
