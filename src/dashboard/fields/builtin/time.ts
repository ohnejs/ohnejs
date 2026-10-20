import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DateFieldOptions } from '../known-field-types.ts';

import { msToISOTime } from '../../../utils/date/ms-to-iso-time.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { h } from '../../render/h.ts';
import { formatTime } from '../../runtime/date-time.ts';
import { parseTime } from '../../ui/time-model.ts';
import { time as timeInput } from '../../ui/time.ts';
import { timeLabels } from '../_temporal.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

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
 * The cell formats the clock in the user's time format; a malformed value shows as its raw text, dim.
 * A nullable control shows a nullish value empty and clears through its clear button.
 * Any other has no empty state, so it shows the earliest time `min` allows, and reads it when required.
 * The control stays pristine until touched; an untouched nullish base wires `null` on a nullable field.
 */
export const timeType: FieldType<DateFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const raw = String(current as string);
      const clock = parseTime(raw);
      if (Number.isNaN(clock)) return dimMark(raw);
      const text = formatTime(clock);
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    let base = initial;
    const seed = field.nullable ? null : (storedClock(field.options?.min) ?? 0);
    const held = ref(initial);
    const clock = ref(storedClock(initial) ?? seed);
    const routed = ref('');

    const error = (): string => routed.value;
    const model: Ref<number | null> = {
      get value() {
        return clock.value;
      },
      set value(next) {
        // A blur settles the shown time again, which is no edit while nothing is stored.
        if (isNullish(held.value) && next === untracked(() => clock.value)) return;
        clock.value = next;
        held.value = isNull(next) ? null : msToISOTime(next);
        routed.value = '';
        onInput();
      },
    };

    const element = timeInput(model, {
      labels: timeLabels(),
      min: field.options?.min,
      max: field.options?.max,
      clearable: field.nullable,
      disabled: () => disabled === true,
    });
    const input = element.querySelector('input.ohne-number-input') as HTMLInputElement;
    describeControl(input, field, path, error);

    const wire = (): unknown => {
      if (isNullish(held.value)) return isNull(clock.value) ? null : msToISOTime(clock.value);
      return held.value;
    };
    const show = (value: unknown): void => {
      held.value = value;
      clock.value = storedClock(value) ?? seed;
      routed.value = '';
    };

    return {
      element,
      read() {
        return isUndefined(held.value) && !field.required ? {} : { value: wire() };
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
        return !isUndefined(held.value) && held.value !== (base ?? null);
      },
      focus() {
        input.focus();
      },
      revert() {
        show(base);
      },
      rebase(value) {
        base = value;
        show(value);
      },
      restore: show,
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
          commit(msToISOTime(next));
        },
      };
      return timeInput(model, { id: inputID, name: inputID, labels: timeLabels() });
    },
  },
};

registerFieldType('time', timeType);
