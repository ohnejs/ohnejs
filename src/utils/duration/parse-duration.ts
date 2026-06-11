import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';

const UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,

  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,

  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,

  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,

  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,

  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,

  mo: 2_592_000_000,
  month: 2_592_000_000,
  months: 2_592_000_000,

  y: 31_536_000_000,
  yr: 31_536_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
};

const SEGMENT =
  /\s*(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|months?|weeks?|years?|days?|mins|secs|hrs|min|sec|hr|mo|ms|yr|m|s|h|d|w|y)\s*/y;

/**
 * Parses a human-readable duration into milliseconds.
 *
 * Accepts a number (returned as-is, treated as ms) or a string of `<value><unit>` segments.
 * Compact (`'7d'`), verbose (`'7 days'`), decimal (`'1.5h'`), and mixed (`'1h 30m'`) forms all work.
 * Units are case-insensitive.
 *
 * Recognized units: `ms`, `s`/`sec(s)`/`second(s)`, `m`/`min(s)`/`minute(s)`, `h`/`hr(s)`/`hour(s)`,
 * `d`/`day(s)`, `w`/`week(s)`, `mo`/`month(s)`, `y`/`yr`/`year(s)`.
 *
 * `mo` and `y` are fixed approximations: 30 days and 365 days.
 * They are meant for configuration values like session lifetimes and cache TTLs, not calendar arithmetic.
 *
 * @example
 * ```ts
 * parseDuration('500ms')          // -> 500
 * parseDuration('1h')             // -> 3600000
 * parseDuration('1.5h')           // -> 5400000
 * parseDuration('1h 30m')         // -> 5400000
 * parseDuration('1 hour 30 mins') // -> 5400000
 * parseDuration('7d')             // -> 604800000
 * parseDuration(3600)             // -> 3600
 * ```
 */
export function parseDuration(input: number | string): number {
  if (isString(input)) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === '') {
      throw new Error(`Invalid duration: "${input}"`);
    }

    let total = 0;
    SEGMENT.lastIndex = 0;

    while (SEGMENT.lastIndex < trimmed.length) {
      const match = SEGMENT.exec(trimmed);
      if (!match) {
        throw new Error(`Invalid duration: "${input}"`);
      }
      total += Number(match[1]) * UNITS[match[2]!]!;
    }

    return total;
  }

  if (!isRealNumber(input) || input < 0) {
    throw new Error(`Invalid duration: ${input}`);
  }
  return input;
}
