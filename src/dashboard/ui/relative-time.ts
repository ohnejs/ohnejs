import { isDate } from '../../utils/is/is-date.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { h } from '../render/h.ts';
import { formatDateTime, formatRelative } from '../runtime/date-time.ts';
import { attachTooltip } from './tooltip.ts';

/**
 * A moment as words relative to now, such as "3 minutes ago", in a `<time>` element.
 * The words follow the dashboard clock and language; the exact date and time show in a tooltip.
 * `datetime` carries the ISO instant for machines.
 *
 * @example
 * ```ts
 * relativeTime(() => record.value.updatedAt)
 * relativeTime(new Date('2026-10-01T12:00:00Z'))
 * ```
 */
export function relativeTime(at: MaybeGetter<number | Date>): HTMLElement {
  const timestamp = (): number => {
    const moment = toValue(at);
    return isDate(moment) ? moment.getTime() : moment;
  };
  const element = h('time', { datetime: () => new Date(timestamp()).toISOString() }, () =>
    formatRelative(timestamp()),
  );
  onCleanup(attachTooltip(element, () => formatDateTime(timestamp())));
  return element;
}
