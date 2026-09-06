import { isString } from '../is/is-string.ts';
import { getOrSet } from '../map/get-or-set.ts';

/**
 * Options for `formatDatePattern`.
 */
export interface DatePatternOptions {
  /**
   * The BCP-47 language tag that renders names, ordinals, meridiems, zone names, and locale weeks.
   */
  language: string;

  /**
   * The IANA time zone the instant reads in, like `Europe/Berlin`.
   * Omitted means the environment's zone.
   */
  timeZone?: string;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offset: string;
}

interface Context extends DatePatternOptions {
  date: Date;
  wall: WallClock;
}

type Renderer = (context: Context) => string;

type Segment = string | Renderer;

const DAY_MS = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ORDINAL_SUFFIXES: Record<Intl.LDMLPluralRule, string> = {
  zero: 'th',
  one: 'st',
  two: 'nd',
  few: 'rd',
  many: 'th',
  other: 'th',
};

const INTL_OPTIONS = {
  MMM: { month: 'short' },
  MMMM: { month: 'long' },
  ddd: { weekday: 'short' },
  dddd: { weekday: 'long' },
  A: { hour: 'numeric', hour12: true },
  z: { timeZoneName: 'short' },
  zzz: { timeZoneName: 'long' },
  L: { year: 'numeric', month: '2-digit', day: '2-digit' },
  l: { year: 'numeric', month: 'numeric', day: 'numeric' },
  LL: { year: 'numeric', month: 'long', day: 'numeric' },
  ll: { year: 'numeric', month: 'short', day: 'numeric' },
  LT: { hour: 'numeric', minute: '2-digit' },
  LTS: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

type IntlKey = keyof typeof INTL_OPTIONS;

const readers = new Map<string, Intl.DateTimeFormat>();
const formatters = new Map<string, Intl.DateTimeFormat>();
const weekRules = new Map<string, [firstDay: number, minimalDays: number]>();
const ordinalRules = new Map<string, Intl.PluralRules | null>();
const patterns = new Map<string, Segment[]>();

/**
 * A number as digits, zero-padded to `width`.
 */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * The instant's wall clock in `timeZone`, read once per call through the zone's memoized parts reader.
 */
function readWall(date: Date, timeZone: string | undefined): WallClock {
  const reader = getOrSet(
    readers,
    timeZone ?? '',
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        fractionalSecondDigits: 3,
        weekday: 'short',
        timeZoneName: 'longOffset',
      }),
  );
  const part = Object.fromEntries(
    reader.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(part.year),
    month: Number(part.month),
    day: Number(part.day),
    weekday: WEEKDAYS.indexOf(part.weekday),
    hour: Number(part.hour),
    minute: Number(part.minute),
    second: Number(part.second),
    millisecond: Number(part.fractionalSecond),
    // A zero offset may name itself `GMT` with no digits.
    offset: part.timeZoneName.slice(3) || '+00:00',
  };
}

/**
 * The memoized language-aware formatter for one name or preset, per language and zone.
 */
function formatterFor(key: IntlKey, { language, timeZone }: Context): Intl.DateTimeFormat {
  return getOrSet(
    formatters,
    `${key}|${language}|${timeZone ?? ''}`,
    () => new Intl.DateTimeFormat(language, { timeZone, ...INTL_OPTIONS[key] }),
  );
}

/**
 * One named part of the instant, like the month name, in the context's language.
 */
function partOf(key: IntlKey, type: Intl.DateTimeFormatPartTypes, context: Context): string {
  const parts = formatterFor(key, context).formatToParts(context.date);
  return parts.find((part) => part.type === type)?.value ?? '';
}

/**
 * A preset like `LL`, rendered whole in the language's own layout.
 */
function preset(key: IntlKey, context: Context): string {
  return formatterFor(key, context).format(context.date);
}

/**
 * A number with its ordinal mark: `1st` in English, `1.` in every other language.
 */
function ordinal(value: number, language: string): string {
  const rules = getOrSet(ordinalRules, language, () =>
    new Intl.Locale(language).language === 'en'
      ? new Intl.PluralRules(language, { type: 'ordinal' })
      : null,
  );
  return rules ? `${value}${ORDINAL_SUFFIXES[rules.select(value)]}` : `${value}.`;
}

/**
 * The language's week rule: its first day and how many days of a year its week 1 must hold.
 * Intl exposes no minimal days, so a Monday-start language takes the ISO 4 and every other language 1.
 */
function weekRule(language: string): [firstDay: number, minimalDays: number] {
  return getOrSet(weekRules, language, () => {
    // Browsers without `getWeekInfo` start the week on Monday.
    const firstDay = new Intl.Locale(language).getWeekInfo?.().firstDay ?? 1;
    return [firstDay, firstDay === 1 ? 4 : 1];
  });
}

/**
 * The calendar day as a count of days since the epoch, so week arithmetic stays integral.
 */
function dayNumber(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / DAY_MS;
}

/**
 * The week of the year for a week that starts on `firstDay`, `1` for Monday through `7` for Sunday.
 * Week 1 is the first week with at least `minimalDays` days in the year, so `1, 4` is the ISO rule.
 * A week belongs to the year that holds its day `8 - minimalDays`, the Thursday under the ISO rule.
 */
function weekOfYear(wall: WallClock, firstDay: number, minimalDays: number): number {
  const start = dayNumber(wall.year, wall.month, wall.day) - ((wall.weekday - firstDay + 7) % 7);
  const decisive = start + 7 - minimalDays;
  const dayOfYear = decisive - dayNumber(new Date(decisive * DAY_MS).getUTCFullYear(), 1, 1);
  return Math.floor(dayOfYear / 7) + 1;
}

const RENDERERS: Record<string, Renderer> = {
  YYYY: ({ wall }) => pad(wall.year, 4),
  YY: ({ wall }) => pad(wall.year % 100),
  M: ({ wall }) => String(wall.month),
  MM: ({ wall }) => pad(wall.month),
  MMM: (context) => partOf('MMM', 'month', context),
  MMMM: (context) => partOf('MMMM', 'month', context),
  D: ({ wall }) => String(wall.day),
  DD: ({ wall }) => pad(wall.day),
  Do: ({ wall, language }) => ordinal(wall.day, language),
  d: ({ wall }) => String(wall.weekday),
  dd: (context) => partOf('ddd', 'weekday', context).slice(0, 2),
  ddd: (context) => partOf('ddd', 'weekday', context),
  dddd: (context) => partOf('dddd', 'weekday', context),
  Q: ({ wall }) => String(Math.ceil(wall.month / 3)),
  w: ({ wall, language }) => String(weekOfYear(wall, ...weekRule(language))),
  ww: ({ wall, language }) => pad(weekOfYear(wall, ...weekRule(language))),
  wo: ({ wall, language }) => ordinal(weekOfYear(wall, ...weekRule(language)), language),
  W: ({ wall }) => String(weekOfYear(wall, 1, 4)),
  WW: ({ wall }) => pad(weekOfYear(wall, 1, 4)),
  H: ({ wall }) => String(wall.hour),
  HH: ({ wall }) => pad(wall.hour),
  h: ({ wall }) => String(wall.hour % 12 || 12),
  hh: ({ wall }) => pad(wall.hour % 12 || 12),
  k: ({ wall }) => String(wall.hour || 24),
  kk: ({ wall }) => pad(wall.hour || 24),
  m: ({ wall }) => String(wall.minute),
  mm: ({ wall }) => pad(wall.minute),
  s: ({ wall }) => String(wall.second),
  ss: ({ wall }) => pad(wall.second),
  SSS: ({ wall }) => pad(wall.millisecond, 3),
  A: (context) => partOf('A', 'dayPeriod', context),
  a: (context) => partOf('A', 'dayPeriod', context).toLowerCase(),
  Z: ({ wall }) => wall.offset,
  ZZ: ({ wall }) => wall.offset.replace(':', ''),
  z: (context) => partOf('z', 'timeZoneName', context),
  zzz: (context) => partOf('zzz', 'timeZoneName', context),
  L: (context) => preset('L', context),
  l: (context) => preset('l', context),
  LL: (context) => preset('LL', context),
  ll: (context) => preset('ll', context),
  LT: (context) => preset('LT', context),
  LTS: (context) => preset('LTS', context),
};

const TOKENS = Object.keys(RENDERERS).sort((a, b) => b.length - a.length);

const TOKEN = new RegExp(`\\[([^\\]]*)]|${TOKENS.join('|')}`, 'g');

/**
 * Splits a pattern into literal spans and token renderers, longest token first.
 */
function tokenize(pattern: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of pattern.matchAll(TOKEN)) {
    if (match.index > cursor) segments.push(pattern.slice(cursor, match.index));
    segments.push(match[1] ?? RENDERERS[match[0]]);
    cursor = match.index + match[0].length;
  }
  if (cursor < pattern.length) segments.push(pattern.slice(cursor));
  return segments;
}

/**
 * Formats an instant with a token pattern like `YYYY-MM-DD HH:mm`, rendered through `Intl`.
 * Tokens match longest first, `[literal]` escapes a span, and every other character passes through.
 *
 * Date: `YYYY` `YY` `M` `MM` `MMM` `MMMM` `D` `DD` `Do` `d` `dd` `ddd` `dddd` `Q` `w` `ww` `wo` `W` `WW`.
 * Time: `H` `HH` `h` `hh` `k` `kk` `m` `mm` `s` `ss` `SSS` `A` `a` `Z` `ZZ` `z` `zzz`.
 * Presets `L` `l` `LL` `ll` `LT` `LTS` render the language's own date or time layout.
 * `W` is the ISO week; `w` starts the week on the language's first day.
 * An unknown `timeZone` throws a `RangeError`, as `Intl.DateTimeFormat` does.
 *
 * @example
 * ```ts
 * const instant = Date.UTC(2025, 1, 24, 20, 30, 25)
 * const english = { language: 'en', timeZone: 'Europe/Berlin' }
 * const german = { language: 'de', timeZone: 'Europe/Berlin' }
 *
 * formatDatePattern(instant, 'YYYY-MM-DD HH:mm', english)          // -> '2025-02-24 21:30'
 * formatDatePattern(instant, 'dddd, MMMM Do [at] h:mm A', english) // -> 'Monday, February 24th at 9:30 PM'
 * formatDatePattern(instant, 'Do MMMM YYYY, LT', german)           // -> '24. Februar 2025, 21:30'
 * ```
 */
export function formatDatePattern(
  timestamp: number,
  pattern: string,
  options: DatePatternOptions,
): string {
  const date = new Date(timestamp);
  const context: Context = { ...options, date, wall: readWall(date, options.timeZone) };
  return getOrSet(patterns, pattern, () => tokenize(pattern))
    .map((segment) => (isString(segment) ? segment : segment(context)))
    .join('');
}
