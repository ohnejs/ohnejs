/**
 * Writes a timestamp's UTC day as an ISO day like `2024-02-29`, the year padded to four digits.
 *
 * @example
 * ```ts
 * msToISODay(86_400_000)      // -> '1970-01-02'
 * msToISODay(-60589296000000)  // -> '0050-01-01'
 * ```
 */
export function msToISODay(ms: number): string {
  const date = new Date(ms);
  const pad = (part: number, width = 2): string => String(part).padStart(width, '0');
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
