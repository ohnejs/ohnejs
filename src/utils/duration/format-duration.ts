import { isRealNumber } from '../is/is-real-number.ts';

/**
 * Visual style for unit labels.
 * Mirrors the `style` option of `Intl.DurationFormat`.
 */
export type FormatDurationStyle = 'narrow' | 'short' | 'long';

/**
 * Options accepted by `formatDuration`.
 */
export interface FormatDurationOptions {
  /**
   * BCP-47 locale tag used for unit names, pluralization, and list joining.
   * Defaults to the runtime's default locale.
   */
  locale?: string;

  /**
   * Unit label style.
   *
   * - `'narrow'` is the tightest form (`'1h 30m'`).
   * - `'short'` uses common abbreviations (`'1 hr, 30 min'`).
   * - `'long'` uses full names (`'1 hour, 30 minutes'`).
   *
   * @default
   * 'narrow'
   */
  style?: FormatDurationStyle;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

/**
 * Formats a millisecond count into a human-readable, localized string.
 *
 * Output is greedy from days down to milliseconds, omitting zero units.
 * Unit names, pluralization, and list joining are delegated to `Intl.DurationFormat`.
 * The result is correct in every locale Node ships CLDR data for.
 *
 * The largest unit is days, so a year reads as `'365d'`.
 *
 * Fractional input is rounded to the nearest whole millisecond.
 *
 * @example
 * ```ts
 * formatDuration(500)        // -> '500ms'
 * formatDuration(1500)       // -> '1s 500ms'
 * formatDuration(90_000)     // -> '1m 30s'
 * formatDuration(90_061_000) // -> '1d 1h 1m 1s'
 *
 * formatDuration(90_061_000, { style: 'long' })
 * // -> '1 day, 1 hour, 1 minute, 1 second'
 *
 * formatDuration(90_061_000, { locale: 'de', style: 'long' })
 * // -> '1 Tag, 1 Stunde, 1 Minute und 1 Sekunde'
 * ```
 */
export function formatDuration(ms: number, options?: FormatDurationOptions): string {
  if (!isRealNumber(ms) || ms < 0) {
    throw new Error(`Invalid duration: ${ms}`);
  }

  const locale = options?.locale;
  const style = options?.style ?? 'narrow';

  const rounded = Math.round(ms);

  if (rounded === 0) {
    return new Intl.DurationFormat(locale, { style, millisecondsDisplay: 'always' }).format({
      milliseconds: 0,
    });
  }

  const days = Math.floor(rounded / DAY_MS);
  let r = rounded - days * DAY_MS;
  const hours = Math.floor(r / HOUR_MS);
  r -= hours * HOUR_MS;
  const minutes = Math.floor(r / MINUTE_MS);
  r -= minutes * MINUTE_MS;
  const seconds = Math.floor(r / SECOND_MS);
  const milliseconds = r - seconds * SECOND_MS;

  return new Intl.DurationFormat(locale, { style }).format({
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
  });
}
