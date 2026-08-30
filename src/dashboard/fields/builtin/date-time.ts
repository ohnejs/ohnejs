import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { calendar } from '../../ui/calendar.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * The memoized instant formatter for `language`, rendering in the viewer's own zone.
 * Cells render per row, and constructing an `Intl.DateTimeFormat` is the expensive part.
 */
function formatInstant(language: string, timestamp: number): string {
  let format = formats.get(language);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    formats.set(language, format);
  }
  return format.format(timestamp);
}

/**
 * The `dateTime` field type: cell display, form control, and filter.
 * The wire value is epoch milliseconds; the calendar edits it straight through, no conversion.
 * The cell and the control format the instant in the dashboard language, in the viewer's own zone.
 * The control stays pristine until touched.
 * A cleared control writes `null` on a nullable field and omits the field otherwise.
 */
export const dateTimeType: FieldType = {
  display({ value, language }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = formatInstant(language(), current as number);
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  control({ field, initial, path, disabled, language, onInput }) {
    let base = initial;
    const stamp = ref(isNumber(base) ? base : null);
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
      withTime: true,
      timezone: 'local',
      formatter: (timestamp) => formatInstant(language(), timestamp),
      placeholder: field.placeholder,
      min: field.options?.min as number | string | undefined,
      max: field.options?.max as number | string | undefined,
      clearable: field.nullable,
      disabled: () => disabled === true,
    });
    const handle = element.querySelector('button.ohne-floater-handle') as HTMLElement;
    describeControl(handle, field, path, error);

    const wire = (): unknown => (touched.value ? stamp.value : (base ?? null));

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
        stamp.value = isNumber(base) ? base : null;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        stamp.value = isNumber(value) ? value : null;
        touched.value = false;
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
    seed: () => Date.now(),
    input({ value, commit, language, inputID }) {
      const model: Ref<number | null> = {
        get value() {
          return Number(value());
        },
        set value(next) {
          if (!isNull(next)) commit(next);
        },
      };
      return calendar(model, {
        withTime: true,
        timezone: 'local',
        formatter: (timestamp) => formatInstant(language(), timestamp),
        clearable: false,
        id: inputID,
        name: inputID,
      });
    },
  },
};

registerFieldType('dateTime', dateTimeType);
