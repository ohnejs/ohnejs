import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { calendar } from '../../ui/calendar.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * A stored `YYYY-MM-DD` day as its UTC-midnight timestamp, `NaN` when malformed.
 * `setUTCFullYear` keeps years 00-99 literal, where `Date.UTC` would remap them to 19xx.
 */
function dayTimestamp(value: string): number {
  const [year, month, day] = value.split('-');
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return date.getTime();
}

/**
 * A UTC-midnight timestamp back in its stored `YYYY-MM-DD` form.
 */
function dayValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A stored value as the calendar's timestamp model, `null` when absent or malformed.
 */
function storedTimestamp(value: unknown): number | null {
  if (!isString(value)) return null;
  const timestamp = dayTimestamp(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * The memoized day formatter for `language`, applied to a UTC-midnight timestamp.
 * Cells render per row, and constructing an `Intl.DateTimeFormat` is the expensive part.
 */
function formatDay(language: string, timestamp: number): string {
  let format = formats.get(language);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
    formats.set(language, format);
  }
  return format.format(timestamp);
}

/**
 * The `date` field type: cell display, form control, and filter.
 * The wire value is a `YYYY-MM-DD` day; the calendar edits its UTC-midnight timestamp.
 * The cell formats the day in the dashboard language; a malformed value shows as its raw text, dim.
 * The control stays pristine until touched.
 * A cleared control writes `null` on a nullable field and omits the field otherwise.
 */
export const dateType: FieldType = {
  display({ value, language }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const raw = String(current as string);
      const timestamp = dayTimestamp(raw);
      if (Number.isNaN(timestamp)) return dimMark(raw);
      const text = formatDay(language(), timestamp);
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
        onInput();
      },
    };

    const element = calendar(model, {
      timezone: 'UTC',
      formatter: (timestamp) => formatDay(language(), timestamp),
      placeholder: field.placeholder,
      min: field.options?.min as string | undefined,
      max: field.options?.max as string | undefined,
      clearable: field.nullable,
      disabled: () => disabled === true,
    });
    const handle = element.querySelector('button.ohne-floater-handle') as HTMLElement;
    describeControl(handle, field, path, error);

    const wire = (): unknown => {
      if (!touched.value) return base ?? null;
      return isNull(stamp.value) ? null : dayValue(stamp.value);
    };

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        const value = wire();
        return isNull(value) && !field.nullable ? {} : { value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty() {
        return touched.value && wire() !== (isUndefined(base) ? undefined : (base ?? null));
      },
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
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
    seed: () => dayValue(Date.now()),
    input({ value, commit, language, inputID }) {
      const model: Ref<number | null> = {
        get value() {
          return storedTimestamp(value());
        },
        set value(next) {
          if (!isNull(next)) commit(dayValue(next));
        },
      };
      return calendar(model, {
        timezone: 'UTC',
        formatter: (timestamp) => formatDay(language(), timestamp),
        clearable: false,
        id: inputID,
        name: inputID,
      });
    },
  },
};

registerFieldType('date', dateType);
