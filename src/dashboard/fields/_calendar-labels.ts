import type { CalendarLabels } from '../ui/calendar.ts';

import { intlLanguage } from '../../utils/i18n/intl-language.ts';
import { getOrSet } from '../../utils/map/get-or-set.ts';
import { useT } from '../runtime/use-t.ts';

type CalendarNames = Pick<Required<CalendarLabels>, 'months' | 'daysShort'>;

const names = new Map<string, CalendarNames>();

/**
 * The calendar labels for `language`.
 * Month and short weekday names come from `Intl`, built once per language.
 * The button tooltips come from the `dashboard.calendar` messages, read through `useT`.
 */
export function calendarLabels(language: string): CalendarLabels {
  const t = useT();
  return {
    ...getOrSet(names, language, () => intlNames(language)),
    clear: t('dashboard.calendar.clear'),
    selectDate: t('dashboard.calendar.selectDate'),
    previousMonth: t('dashboard.calendar.previousMonth'),
    nextMonth: t('dashboard.calendar.nextMonth'),
  };
}

/**
 * The twelve month names and the seven short weekday names, Sunday first, in `language`.
 * Both read `UTC` instants, so the device zone never shifts a month start or a weekday.
 */
function intlNames(language: string): CalendarNames {
  const tag = intlLanguage(language);
  const month = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
  return {
    months: Array.from({ length: 12 }, (_, index) => month.format(Date.UTC(2024, index, 1))),
    daysShort: Array.from({ length: 7 }, (_, index) =>
      weekday.format(Date.UTC(2024, 0, 7 + index)),
    ),
  };
}
