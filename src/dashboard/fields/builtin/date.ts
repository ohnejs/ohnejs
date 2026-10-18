import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DateFieldOptions } from '../known-field-types.ts';

import { isoDayToMs } from '../../../utils/date/iso-day-to-ms.ts';
import { msToISODay } from '../../../utils/date/ms-to-iso-day.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { checkRange } from '../../../utils/validate/check-range.ts';
import { h } from '../../render/h.ts';
import { formatDate } from '../../runtime/date-time.ts';
import { calendar } from '../../ui/calendar.ts';
import { calendarLabels } from '../_calendar-labels.ts';
import { checkedReading } from '../_checked-reading.ts';
import { todayStamp } from '../_temporal.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * A stored value as the calendar's timestamp model, `null` when absent or malformed.
 */
function storedTimestamp(value: unknown): number | null {
  if (!isString(value)) return null;
  return isoDayToMs(value) ?? null;
}

/**
 * The `date` field type: cell display, form control, and filter.
 * The wire value is a `YYYY-MM-DD` day; the calendar edits its UTC-midnight timestamp.
 * The cell formats the day in the user's date format; a malformed value shows as its raw text, dim.
 * The control stays pristine until touched.
 * A cleared control writes `null` on a nullable field and omits the field otherwise.
 * A changed day is checked against `min` and `max`, with the server's messages.
 */
export const dateType: FieldType<DateFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const raw = String(current as string);
      const timestamp = isoDayToMs(raw);
      if (isUndefined(timestamp)) return dimMark(raw);
      const text = formatDate(timestamp);
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  control({ field, initial, path, disabled, language, onInput }) {
    let base = initial;
    const stamp = ref(storedTimestamp(base));
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const model: Ref<number | null> = {
      get value() {
        return stamp.value;
      },
      set value(next) {
        stamp.value = next;
        touched.value = true;
        routed.value = '';
        onInput(true);
      },
    };

    const element = calendar(model, {
      timezone: 'UTC',
      today: todayStamp(),
      formatter: formatDate,
      labels: () => calendarLabels(language()),
      placeholder: fieldPlaceholder(field),
      min: field.options?.min,
      max: field.options?.max,
      clearable: field.nullable,
      disabled: () => disabled === true,
    });
    const handle = element.querySelector('button.ohne-floater-handle') as HTMLElement;
    describeControl(handle, field, path, error);

    const wire = (): unknown => {
      if (!touched.value) return base ?? null;
      return isNull(stamp.value) ? null : msToISODay(stamp.value);
    };

    const dirty = (): boolean =>
      touched.value && wire() !== (isUndefined(base) ? undefined : (base ?? null));

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        const value = wire();
        if (isNull(value) && !field.nullable) return {};
        return checkedReading(
          value,
          isString(value) && dirty() ? checkRange(value, field.options ?? {}) : undefined,
        );
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty,
      focus() {
        handle.focus();
      },
      revert() {
        stamp.value = storedTimestamp(base);
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        stamp.value = storedTimestamp(value);
        touched.value = false;
        routed.value = '';
      },
      restore(value) {
        stamp.value = storedTimestamp(value);
        touched.value = !isUndefined(value);
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
    seed: () => msToISODay(todayStamp()),
    input({ value, commit, language, inputID }) {
      const model: Ref<number | null> = {
        get value() {
          return storedTimestamp(value());
        },
        set value(next) {
          if (!isNull(next)) commit(msToISODay(next));
        },
      };
      return calendar(model, {
        timezone: 'UTC',
        today: todayStamp(),
        formatter: formatDate,
        labels: () => calendarLabels(language()),
        clearable: false,
        id: inputID,
        name: inputID,
      });
    },
  },
};

registerFieldType('date', dateType);
