import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { h } from '../../render/h.ts';
import { parseTime } from '../../ui/time-model.ts';
import { time as timeInput } from '../../ui/time.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * A time-of-day in ms back in its stored `HH:MM:SS` form.
 */
function clockValue(value: number): string {
  const total = Math.floor(value / 1000);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

/**
 * A stored value as the time input's ms model, `null` when absent or malformed.
 */
function storedClock(value: unknown): number | null {
  if (!isString(value)) return null;
  const parsed = parseTime(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The `time` field type: cell display, form control, and filter.
 * The wire value is an `HH:MM:SS` time of day; the segment input edits it as ms within the day.
 * The input has no empty state, so the model seeds `00:00:00` when the stored value is nullish.
 * The control stays pristine until touched; an untouched nullish base wires `null` on a nullable field.
 */
export const timeType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = String(current as string);
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    let base = initial;
    const clock = ref(storedClock(base) ?? 0);
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const model: Ref<number> = {
      get value() {
        return clock.value;
      },
      set value(next) {
        clock.value = next;
        touched.value = true;
        routed.value = '';
        onInput();
      },
    };

    const element = timeInput(model, {
      min: field.options?.min as string | undefined,
      max: field.options?.max as string | undefined,
      disabled: () => disabled === true,
    });
    const input = element.querySelector('input.ohne-number-input') as HTMLInputElement;
    describeControl(input, field, path, error);

    const wire = (): unknown => {
      if (touched.value) return clockValue(clock.value);
      return isNullish(base) ? (field.nullable ? null : clockValue(clock.value)) : base;
    };

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        return { value: wire() };
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
        input.focus();
      },
      revert() {
        clock.value = storedClock(base) ?? 0;
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        clock.value = storedClock(value) ?? 0;
        touched.value = false;
        routed.value = '';
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
    seed: () => '00:00:00',
    input({ value, commit, inputID }) {
      const model: Ref<number> = {
        get value() {
          return storedClock(value()) ?? 0;
        },
        set value(next) {
          commit(clockValue(next));
        },
      };
      return timeInput(model, { id: inputID, name: inputID });
    },
  },
};

registerFieldType('time', timeType);
