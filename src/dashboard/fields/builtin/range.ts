import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { RangeFieldOptions } from '../known-field-types.ts';

import { isoDayToMs } from '../../../utils/date/iso-day-to-ms.ts';
import { isoTimeToMs } from '../../../utils/date/iso-time-to-ms.ts';
import { msToISODay } from '../../../utils/date/ms-to-iso-day.ts';
import { msToISOTime } from '../../../utils/date/ms-to-iso-time.ts';
import { parseWholeDuration } from '../../../utils/duration/parse-whole-duration.ts';
import { isInteger } from '../../../utils/is/is-integer.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { checkSpan } from '../../../utils/validate/check-span.ts';
import { h } from '../../render/h.ts';
import { formatDate, formatDateTime, formatTime } from '../../runtime/date-time.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { calendarRange } from '../../ui/calendar-range.ts';
import { timeRange } from '../../ui/time-range.ts';
import { calendarLabels } from '../_calendar-labels.ts';
import { checkedReading } from '../_checked-reading.ts';
import { boundInstant, calendarZone, timeLabels, todayStamp } from '../_temporal.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { controlIDs, dimMark, type FieldType, registerFieldType } from '../field-type.ts';

type Kind = RangeFieldOptions['of'];
type Pair = [number | null, number | null];

const LAST_SECOND = 86_399_000;

/**
 * The `range` field type: cell display, summary, and form control.
 * The wire value is `{ start, end }`, each end in its `of` type's stored form; the control edits both as ms.
 * A `date` or `dateTime` range edits in two linked calendars, a `time` range in two linked time inputs.
 * The cell and summary read `start - end` in the user's formats, or `From start` while an open end is `null`.
 * The control stays pristine until touched; a cleared nullable range writes `null`.
 * A changed range is checked against `minSpan` and `maxSpan`, with the server's messages.
 */
export const rangeType: FieldType<RangeFieldOptions> = {
  display({ field, value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = rangeText(current, field);
      if (isUndefined(text)) return dimMark(rawText(current));
      return h('span', { class: 'ohne-truncate', title: text }, text);
    };
  },
  summary(value, field) {
    return isNullish(value) ? '' : (rangeText(value, field) ?? '');
  },
  control({ field, initial, path, disabled, language, onInput }) {
    const t = useT();
    const of = kindOf(field);
    const open = field.options?.open === true;
    const minSpan = field.options?.minSpan;
    const maxSpan = field.options?.maxSpan;
    let base = initial;
    const pair = ref<Pair>(storedPair(base, of));
    const touched = ref(false);
    const routed = ref('');

    const model: Ref<Pair> = {
      get value() {
        return pair.value;
      },
      set value(next) {
        pair.value = next;
        touched.value = true;
        routed.value = '';
        onInput(of !== 'time');
      },
    };
    const placeholderFrom = fieldPlaceholder(field) ?? (() => t('dashboard.range.start'));
    const placeholderTo = () => t(open ? 'dashboard.range.noEnd' : 'dashboard.range.end');
    const off = (): boolean => disabled === true;
    const minRange = parseWholeDuration(minSpan);
    const maxRange = parseWholeDuration(maxSpan);

    // A required time range reads the seed it shows.
    let seeded: Pair | undefined;
    let element: HTMLElement;
    if (of === 'time') {
      const min = field.options?.min;
      const first = (isString(min) ? isoTimeToMs(min) : undefined) ?? 0;
      // The inputs have no empty state, so an empty pair shows the earliest pair its bounds allow.
      const seed: [number, number] = [first, Math.min(first + (minRange ?? 0), LAST_SECOND)];
      if (!field.nullable) seeded = seed;
      const clock: Ref<[number, number]> = {
        get value(): [number, number] {
          const [start, end] = pair.value;
          return [start ?? seed[0], end ?? seed[1]];
        },
        set value(next) {
          if (
            !touched.value &&
            deepEqual(
              next,
              untracked(() => clock.value),
            )
          )
            return;
          model.value = next;
        },
      };
      element = timeRange(clock, {
        labels: timeLabels(),
        min: field.options?.min,
        max: field.options?.max,
        minRange,
        maxRange,
        disabled: off,
      });
    } else {
      const zone = field.options?.timezone;
      const day = of === 'date';
      element = calendarRange(model, {
        ...(day
          ? { timezone: 'UTC', today: todayStamp(), formatter: formatDate, min: field.options?.min }
          : {
              withTime: true,
              timezone: calendarZone(zone),
              formatter: (timestamp: number) => formatDateTime(timestamp, zone),
              min: boundInstant(field.options?.min),
            }),
        max: day ? field.options?.max : boundInstant(field.options?.max),
        minRange,
        maxRange: maxRange ?? null,
        labels: () => calendarLabels(language()),
        placeholderFrom,
        placeholderTo,
        clearableFrom: field.nullable,
        clearableTo: field.nullable || open,
        disabled: off,
      });
    }
    const [first, second] = element.querySelectorAll(
      of === 'time' ? 'input.ohne-number-input' : 'button.ohne-floater-handle',
    ) as unknown as HTMLElement[];
    describeControl(first!, field, path, () => routed.value);
    if (of !== 'time') {
      // Each handle's own text, the chosen end or its placeholder, follows the field label in its name.
      const ids = controlIDs(path);
      second!.id = `${ids.input}-end`;
      first!.setAttribute('aria-labelledby', `${ids.label} ${first!.id}`);
      second!.setAttribute('aria-labelledby', `${ids.label} ${second!.id}`);
      second!.setAttribute('aria-describedby', ids.description);
    }

    const baseValue = (): unknown => (isUndefined(base) ? undefined : ends(base));
    // The value the control holds: the base's own ends while untouched, else the pair in wire form.
    const current = (): unknown => {
      if (!touched.value) return baseValue();
      const [start, end] = pair.value;
      if (isNull(start) && isNull(end)) return null;
      return { start: wire(start, of), end: wire(end, of) };
    };
    const dirty = (): boolean => touched.value && !deepEqual(current(), baseValue() ?? null);

    return {
      element,
      read() {
        if (!touched.value) {
          if (isUndefined(base)) {
            return isUndefined(seeded)
              ? {}
              : { value: { start: wire(seeded[0], of), end: wire(seeded[1], of) } };
          }
          const value = baseValue();
          return isNull(value) && !field.nullable ? {} : { value };
        }
        const [start, end] = pair.value;
        if (isNull(start) && isNull(end)) return field.nullable ? { value: null } : {};
        if (isNull(start)) return { errors: { start: translateMessage('validation.required') } };
        if (isNull(end) && !open)
          return { errors: { end: translateMessage('validation.required') } };
        const failure =
          isNull(end) || !dirty()
            ? undefined
            : checkSpan(start, end, { min: minSpan, max: maxSpan });
        return checkedReading(current(), failure);
      },
      draft() {
        return !touched.value && isUndefined(base) ? undefined : current();
      },
      setErrors(errors) {
        const { '': own, start, end } = errors;
        routed.value =
          own ??
          (isUndefined(start) ? undefined : `${t('dashboard.range.start')}: ${start}`) ??
          (isUndefined(end) ? undefined : `${t('dashboard.range.end')}: ${end}`) ??
          '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '' && key !== 'start' && key !== 'end') return message;
        }
        return '';
      },
      error: () => routed.value,
      dirty,
      focus() {
        first!.focus();
      },
      revert() {
        pair.value = storedPair(base, of);
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        pair.value = storedPair(value, of);
        touched.value = false;
        routed.value = '';
      },
      restore(value) {
        pair.value = storedPair(value, of);
        touched.value = !isUndefined(value);
        routed.value = '';
      },
    };
  },
};

/**
 * The field's `of`, the kind both ends hold.
 */
function kindOf(field: DashboardField): Kind {
  return (field.options?.of as Kind | undefined) ?? 'date';
}

/**
 * A stored range's `{ start, end }` without its `UUID`, or `null` when it holds none.
 */
function ends(value: unknown): unknown {
  return isPlainObject(value) ? { start: value.start, end: value.end } : null;
}

/**
 * A stored end as ms on its kind's own line, `null` when absent or malformed.
 */
function storedEnd(value: unknown, of: Kind): number | null {
  if (of === 'dateTime') return isInteger(value) ? value : null;
  if (!isString(value)) return null;
  return (of === 'date' ? isoDayToMs(value) : isoTimeToMs(value)) ?? null;
}

/**
 * A stored range as the control's ms pair, `[null, null]` when it holds none.
 */
function storedPair(value: unknown, of: Kind): Pair {
  if (!isPlainObject(value)) return [null, null];
  return [storedEnd(value.start, of), storedEnd(value.end, of)];
}

/**
 * An end's ms back in its kind's stored form.
 */
function wire(ms: number | null, of: Kind): unknown {
  if (isNull(ms) || of === 'dateTime') return ms;
  return of === 'date' ? msToISODay(ms) : msToISOTime(ms);
}

/**
 * An end's ms in the user's format for its kind.
 */
function formatEnd(ms: number, field: DashboardField): string {
  const of = kindOf(field);
  if (of === 'date') return formatDate(ms);
  if (of === 'time') return formatTime(ms);
  return formatDateTime(ms, field.options?.timezone as string | undefined);
}

/**
 * A range as one line of text, or `undefined` when an end is malformed.
 * An `open` end that is `null` reads as the range's start alone.
 */
function rangeText(value: unknown, field: DashboardField): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const of = kindOf(field);
  const start = storedEnd(value.start, of);
  const end = storedEnd(value.end, of);
  if (isNull(start)) return undefined;
  const t = useT();
  if (isNull(end)) {
    return isNull(value.end)
      ? t('dashboard.range.from', { start: formatEnd(start, field) })
      : undefined;
  }
  return t('dashboard.range.between', {
    start: formatEnd(start, field),
    end: formatEnd(end, field),
  });
}

/**
 * A malformed range's raw ends, for the dimmed cell.
 */
function rawText(value: unknown): string {
  if (!isPlainObject(value)) return String(value);
  return `${String(value.start)} - ${String(value.end)}`;
}

registerFieldType('range', rangeType);
