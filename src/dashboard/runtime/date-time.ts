import { formatDatePattern } from '../../utils/i18n/format-date-pattern.ts';
import { formatRelativeTime } from '../../utils/i18n/format-relative-time.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isTimezone } from '../../utils/is/is-timezone.ts';
import { getOrSet } from '../../utils/map/get-or-set.ts';
import { useNow } from './clock.ts';
import { sessionUser } from './session.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

/**
 * How the signed-in user reads dates and times, derived from the session and the dashboard language.
 */
export interface DateTimePreferences {
  /**
   * The dashboard language: names, ordinals, meridiems, and the `L` presets render in it.
   */
  language: string;

  /**
   * The IANA time zone instants display in; `undefined` means the device's own zone.
   */
  timeZone: string | undefined;

  /**
   * The pattern dates format with.
   */
  dateFormat: string;

  /**
   * The pattern times format with.
   */
  timeFormat: string;
}

const accepted = new Map<string, boolean>();

/**
 * The signed-in user's date and time preferences, read reactively.
 * The language follows `useDashboardLanguage`; the zone and the patterns follow `sessionUser`.
 * Signed out, or while the session resolves, the patterns fall back to the `LL` and `LTS` presets.
 * A stored zone the browser's ICU rejects reads as `undefined`, the device's own zone.
 *
 * @example
 * ```ts
 * // A German user in Berlin, with `DD.MM.YYYY` and `HH:mm` set
 * dateTimePreferences()
 * // -> { language: 'de', timeZone: 'Europe/Berlin', dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm' }
 * ```
 */
export function dateTimePreferences(): DateTimePreferences {
  const user = sessionUser();
  return {
    language: useDashboardLanguage().value,
    timeZone: acceptedZone(user?.timezone),
    dateFormat: user?.dateFormat ?? 'LL',
    timeFormat: user?.timeFormat ?? 'LTS',
  };
}

/**
 * Formats an instant in the user's date and time patterns, a space between them.
 * `timeZone` pins the zone a field declares; omitted, the user's zone applies.
 *
 * @example
 * ```ts
 * // With `en`, the `LL` and `LTS` presets, and a device in UTC
 * const instant = Date.UTC(2025, 1, 24, 20, 30, 25)
 *
 * formatDateTime(instant)                  // -> 'February 24, 2025 8:30:25 PM'
 * formatDateTime(instant, 'Europe/Berlin') // -> 'February 24, 2025 9:30:25 PM'
 * ```
 */
export function formatDateTime(timestamp: number, timeZone?: string): string {
  const { language, timeZone: zone, dateFormat, timeFormat } = dateTimePreferences();
  return formatDatePattern(timestamp, `${dateFormat} ${timeFormat}`, {
    language,
    timeZone: timeZone ?? zone,
  });
}

/**
 * Formats a calendar day in the user's date pattern.
 * A day is stored as its UTC midnight, so it reads in `UTC` whatever the user's zone.
 *
 * @example
 * ```ts
 * formatDate(Date.UTC(2025, 1, 24)) // -> 'February 24, 2025'
 * ```
 */
export function formatDate(timestamp: number): string {
  const { language, dateFormat } = dateTimePreferences();
  return formatDatePattern(timestamp, dateFormat, { language, timeZone: 'UTC' });
}

/**
 * Formats a clock time in the user's time pattern.
 * A clock is stored as milliseconds since midnight, so it reads in `UTC` whatever the user's zone.
 *
 * @example
 * ```ts
 * formatTime(parseTime('20:30:25')) // -> '8:30:25 PM'
 * ```
 */
export function formatTime(timestamp: number): string {
  const { language, timeFormat } = dateTimePreferences();
  return formatDatePattern(timestamp, timeFormat, { language, timeZone: 'UTC' });
}

/**
 * Words an instant relative to now in the dashboard language, like "2 hours ago" or "in 3 days".
 * Now is `useNow`, so a string rendered in a reactive region refreshes as the clock ticks.
 *
 * @example
 * ```ts
 * formatRelative(Date.now() - 7_200_000)                   // -> '2 hours ago'
 * h('span', null, () => formatRelative(record._updatedAt)) // ticks every 30 seconds
 * ```
 */
export function formatRelative(timestamp: number): string {
  return formatRelativeTime(timestamp, useNow().value, useDashboardLanguage().value);
}

/**
 * The zone itself when the browser's ICU accepts it, else `undefined`.
 * Each verdict is memoized, so the cells stay cheap.
 */
function acceptedZone(zone: string | null | undefined): string | undefined {
  if (isNullish(zone)) return undefined;
  return getOrSet(accepted, zone, () => isTimezone(zone)) ? zone : undefined;
}
