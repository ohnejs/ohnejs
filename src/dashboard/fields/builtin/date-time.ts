import type { Ref } from '../../../utils/reactive/ref.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { onCleanup } from '../../../utils/reactive/effect-scope.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { h } from '../../render/h.ts';
import { dateTimePreferences, formatDateTime, formatRelative } from '../../runtime/date-time.ts';
import { parseDateTime } from '../../ui/calendar-date.ts';
import { calendar } from '../../ui/calendar.ts';
import { attachTooltip } from '../../ui/tooltip.ts';
import { calendarLabels } from '../_calendar-labels.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';

/**
 * The zone a calendar opens in: the field's pinned zone, else the user's, else the device's.
 * The user's zone is read untracked, since every account save rewrites the user record.
 * A tracked read would rebuild the control on each save and drop its edits.
 */
function calendarZone(pinned: string | undefined): string {
  return pinned ?? untracked(() => dateTimePreferences().timeZone) ?? 'local';
}

/**
 * A `min` or `max` bound as the instant the server validates against, or `undefined` when unset.
 */
function instant(bound: unknown): number | undefined {
  return isNumber(bound) || isString(bound) ? parseDateTime(bound) : undefined;
}

/**
 * The `dateTime` field type: cell display, form control, and filter.
 * The wire value is epoch milliseconds; the calendar edits it straight through, no conversion.
 * The cell shows the instant in the user's date and time formats, its relative wording as a tooltip.
 * The field's `relativeTime` option swaps the two: relative text, absolute tooltip.
 * The field's `timezone` option pins the zone; omitted, the user's zone applies, then the device's.
 * The control's handle stays absolute either way, since it edits an instant.
 * The control stays pristine until touched.
 * A cleared control writes `null` on a nullable field and omits the field otherwise.
 */
export const dateTimeType: FieldType = {
  display({ field, value }) {
    const zone = field.options?.timezone as string | undefined;
    const relativeTime = field.options?.relativeTime === true;
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const instant = current as number;
      const absolute = (): string => formatDateTime(instant, zone);
      const relative = (): string => formatRelative(instant);
      // A function child, so a clock tick patches the text alone and never rebuilds the element mid-hover.
      const element = h('span', { class: 'ohne-truncate' }, relativeTime ? relative : absolute);
      onCleanup(attachTooltip(element, relativeTime ? absolute : relative));
      return element;
    };
  },
  control({ field, initial, path, disabled, language, onInput }) {
    const zone = field.options?.timezone as string | undefined;
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
      timezone: calendarZone(zone),
      formatter: (timestamp) => formatDateTime(timestamp, zone),
      labels: calendarLabels(language()),
      placeholder: field.placeholder,
      min: instant(field.options?.min),
      max: instant(field.options?.max),
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
    input({ field, value, commit, language, inputID }) {
      const zone = field.options?.timezone as string | undefined;
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
        timezone: calendarZone(zone),
        formatter: (timestamp) => formatDateTime(timestamp, zone),
        labels: calendarLabels(language()),
        clearable: false,
        id: inputID,
        name: inputID,
      });
    },
  },
};

registerFieldType('dateTime', dateTimeType);
