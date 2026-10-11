import type { CalendarLabels } from '../ui/calendar.ts';

import { intlData } from '../../utils/i18n/intl-data.ts';
import { intlLanguage } from '../../utils/i18n/intl-language.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { useT } from '../runtime/use-t.ts';

type CalendarNames = Pick<Required<CalendarLabels>, 'months' | 'daysShort'>;

const names = new Map<string, CalendarNames>();

/**
 * The calendar labels for `language`.
 * Month and short weekday names come from `Intl`, or the registered `IntlData` the browser lacks.
 * They are built once per language, once a source has them.
 * The button tooltips and the time suffixes come from the `dashboard` messages, read through `useT`.
 */
export function calendarLabels(language: string): CalendarLabels {
  const t = useT();
  return {
    ...namesOf(language),
    clear: t('dashboard.calendar.clear'),
    selectDate: t('dashboard.calendar.selectDate'),
    previousMonth: t('dashboard.calendar.previousMonth'),
    nextMonth: t('dashboard.calendar.nextMonth'),
    hoursSuffix: t('dashboard.time.hours'),
    minutesSuffix: t('dashboard.time.minutes'),
    secondsSuffix: t('dashboard.time.seconds'),
  };
}

/**
 * The memoized names for `language`; a language waiting on its `IntlData` is built again on each read.
 */
function namesOf(language: string): CalendarNames {
  const cached = names.get(language);
  if (!isUndefined(cached)) return cached;
  const built = intlNames(language);
  if (!isUndefined(intlLanguage(language)) || !isUndefined(intlData(language))) {
    names.set(language, built);
  }
  return built;
}

/**
 * The twelve month names and the seven short weekday names, Sunday first, in `language`.
 * Both read `UTC` instants, so the device zone never shifts a month start or a weekday.
 */
function intlNames(language: string): CalendarNames {
  const tag = intlLanguage(language);
  const data = isUndefined(tag) ? intlData(language) : undefined;
  if (!isUndefined(data)) return { months: data.months.long, daysShort: data.weekdays.short };
  const month = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
  return {
    months: Array.from({ length: 12 }, (_, index) => month.format(Date.UTC(2024, index, 1))),
    daysShort: Array.from({ length: 7 }, (_, index) =>
      weekday.format(Date.UTC(2024, 0, 7 + index)),
    ),
  };
}
