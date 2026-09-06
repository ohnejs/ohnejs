import { getOrSet } from '../map/get-or-set.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365.25 * DAY;
const MONTH = YEAR / 12;

/**
 * One rung of the ladder.
 * A span measured in `size` whose rounded count stays within `limit` renders in `unit`.
 * It renders as `fixed` when set, else as the count itself.
 */
type Rung = readonly [
  size: number,
  limit: number,
  unit: Intl.RelativeTimeFormatUnit,
  fixed?: number,
];

const LADDER: readonly Rung[] = [
  [SECOND, 44, 'second', 0],
  [SECOND, 89, 'minute', 1],
  [MINUTE, 44, 'minute'],
  [MINUTE, 89, 'hour', 1],
  [HOUR, 21, 'hour'],
  [HOUR, 35, 'day', 1],
  [DAY, 25, 'day'],
  [DAY, 45, 'month', 1],
  [MONTH, 10, 'month'],
  [MONTH, 17, 'year', 1],
];

const formats = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Formats the distance between two instants in words, like "2 hours ago" or "in 3 days".
 * Both are epoch milliseconds; a `timestamp` before `now` reads as the past, after it as the future.
 *
 * The span rounds to the unit that reads best, climbing one rung at a time.
 * Under 45 seconds reads as now.
 * Up to 89 seconds reads as one minute, then minutes up to 44 of them.
 * Up to 89 minutes reads as one hour, then hours up to 21 of them.
 * Up to 35 hours reads as one day, then days up to 25 of them.
 * Up to 45 days reads as one month, then months up to 10 of them.
 * Up to 17 months reads as one year, then years.
 * Every bound compares the span rounded to the unit it names.
 * A month is a twelfth of a 365.25-day year.
 *
 * Words come from `Intl.RelativeTimeFormat` with `numeric: 'auto'`, so one day back reads "yesterday".
 * One formatter is kept per language.
 *
 * @example
 * ```ts
 * const now = Date.now()
 * formatRelativeTime(now - 10_000, now, 'en')      // -> 'now'
 * formatRelativeTime(now - 7_200_000, now, 'en')   // -> '2 hours ago'
 * formatRelativeTime(now - 86_400_000, now, 'de')  // -> 'gestern'
 * formatRelativeTime(now + 259_200_000, now, 'bs') // -> 'za 3 dana'
 * ```
 */
export function formatRelativeTime(timestamp: number, now: number, language: string): string {
  const format = formatFor(language);
  const span = Math.abs(timestamp - now);
  const sign = timestamp < now ? -1 : 1;
  for (const [size, limit, unit, fixed] of LADDER) {
    const count = Math.round(span / size);
    if (count <= limit) return format.format(sign * (fixed ?? count), unit);
  }
  return format.format(sign * Math.round(span / YEAR), 'year');
}

/**
 * The memoized relative-time formatter for `language`.
 */
function formatFor(language: string): Intl.RelativeTimeFormat {
  return getOrSet(
    formats,
    language,
    () => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }),
  );
}
