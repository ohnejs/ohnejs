import type { TimeLabels } from '../ui/time.ts';

import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { dateTimePreferences } from '../runtime/date-time.ts';
import { useT } from '../runtime/use-t.ts';
import {
  parseDateTime,
  resolveTimezone,
  zonedFromTimestamp,
  zonedFromWallClock,
} from '../ui/calendar-date.ts';

/**
 * The user's current day as its UTC-midnight timestamp, the encoding a day calendar edits.
 * The user's zone is read untracked, as in `calendarZone`, so an account save never rebuilds a control.
 */
export function todayStamp(): number {
  const zone = resolveTimezone(untracked(() => dateTimePreferences().timeZone));
  const now = zonedFromTimestamp(Date.now(), zone);
  return zonedFromWallClock('UTC', now.year, now.month, now.day).timestamp;
}

/**
 * The zone an instant calendar opens in: the field's pinned zone, else the user's, else the device's.
 * The user's zone is read untracked, since every account save rewrites the user record.
 * A tracked read would rebuild the control on each save and drop its edits.
 */
export function calendarZone(pinned: string | undefined): string {
  return pinned ?? untracked(() => dateTimePreferences().timeZone) ?? 'local';
}

/**
 * An instant field's `min` or `max` as the epoch milliseconds the server checks, `undefined` when unset.
 */
export function boundInstant(bound: unknown): number | undefined {
  return isNumber(bound) || isString(bound) ? parseDateTime(bound) : undefined;
}

/**
 * The segment suffixes of a time input, live in the dashboard language.
 */
export function timeLabels(): TimeLabels {
  const t = useT();
  return {
    hoursSuffix: () => t('dashboard.time.hours'),
    minutesSuffix: () => t('dashboard.time.minutes'),
    secondsSuffix: () => t('dashboard.time.seconds'),
  };
}
