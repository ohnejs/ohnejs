/**
 * Formats a duration in milliseconds as a running clock: `m:ss`, or `h:mm:ss` from one hour on.
 * Partial seconds are cut, and a negative duration shows `0:00`.
 *
 * @example
 * ```ts
 * formatClock(65_000)    // -> '1:05'
 * formatClock(3_725_000) // -> '1:02:05'
 * formatClock(-500)      // -> '0:00'
 * ```
 */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
