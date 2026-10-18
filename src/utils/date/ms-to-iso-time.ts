/**
 * Writes milliseconds into the day as an ISO time in full `HH:MM:SS` form, whole seconds only.
 *
 * @example
 * ```ts
 * msToISOTime(34_200_000) // -> '09:30:00'
 * msToISOTime(1_000)      // -> '00:00:01'
 * ```
 */
export function msToISOTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
