import type { Ref } from '../../../utils/reactive/ref.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { Text } from '../../runtime/text-type.ts';
import type { IntegerFieldOptions, RangeFieldOptions } from '../known-field-types.ts';

import { isoDayToMs } from '../../../utils/date/iso-day-to-ms.ts';
import { isoTimeToMs } from '../../../utils/date/iso-time-to-ms.ts';
import { msToISODay } from '../../../utils/date/ms-to-iso-day.ts';
import { msToISOTime } from '../../../utils/date/ms-to-iso-time.ts';
import { parseWholeDuration } from '../../../utils/duration/parse-whole-duration.ts';
import { formatCurrencyIn } from '../../../utils/i18n/format-currency-in.ts';
import { isCurrencyCode } from '../../../utils/is/is-currency-code.ts';
import { isInteger } from '../../../utils/is/is-integer.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isRealNumber } from '../../../utils/is/is-real-number.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { batchedEffect } from '../../../utils/reactive/batched-effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { checkNumberSpan } from '../../../utils/validate/check-number-span.ts';
import { checkSpan } from '../../../utils/validate/check-span.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { formatDate, formatDateTime, formatTime } from '../../runtime/date-time.ts';
import { translateMessage, useT } from '../../runtime/use-t.ts';
import { calendarRange } from '../../ui/calendar-range.ts';
import { sliderRange } from '../../ui/slider-range.ts';
import { timeRange } from '../../ui/time-range.ts';
import { calendarLabels } from '../_calendar-labels.ts';
import { checkedReading } from '../_checked-reading.ts';
import { boundInstant, calendarZone, timeLabels, todayStamp } from '../_temporal.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import {
  controlIDs,
  dimMark,
  type FieldControl,
  type FieldControlContext,
  type FieldType,
  registerFieldType,
} from '../field-type.ts';
import { integerType } from './integer.ts';
import { numberType } from './number.ts';

type Kind = RangeFieldOptions['of'];
type Pair = [number | null, number | null];
type Ends = [number | undefined, number | undefined];
type Bound = 'min' | 'max' | 'minSpan' | 'maxSpan';

const LAST_SECOND = 86_399_000;
const KEYS = ['start', 'end'] as const;

css`
  .ohne-range-numeric {
    display: flex;
    flex-direction: column;
    gap: 0.75em;
  }

  .ohne-range-numeric-ends {
    display: flex;
    gap: 0.5em;
  }

  .ohne-range-numeric-ends > * {
    flex: 1;
    min-width: 0;
  }
`;

/**
 * The `range` field type: cell display, summary, and form control.
 * The wire value is `{ start, end }`, each end in its `of` type's stored form.
 * A `date` or `dateTime` range edits in two linked calendars, a `time` range in two linked time inputs.
 * A numeric range edits in an `integer` or `number` control per end, as `numericControl` describes.
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
      const unit = translateMessage(field.options?.suffix);
      if (isUndefined(unit)) return h('span', { class: 'ohne-truncate', title: text }, text);
      return h(
        'span',
        { class: 'ohne-numeric-cell', title: `${text} ${unit}` },
        h('span', { class: 'ohne-truncate' }, text),
        dimMark(unit),
      );
    };
  },
  summary(value, field) {
    const text = isNullish(value) ? undefined : rangeText(value, field);
    if (isUndefined(text)) return '';
    const unit = translateMessage(field.options?.suffix);
    return isUndefined(unit) ? text : `${text} ${unit}`;
  },
  control(context) {
    const of = kindOf(context.field);
    if (of === 'integer' || of === 'number') return numericControl(context, of);
    const { field, initial, path, disabled, language, onInput } = context;
    const t = useT();
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

    const baseValue = (): unknown => (isUndefined(base) ? undefined : stored(base));
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
function stored(value: unknown): unknown {
  return isPlainObject(value) ? { start: value.start, end: value.end } : null;
}

/**
 * A stored end as a number on its kind's own line, ms for a temporal kind, `null` when absent or malformed.
 */
function storedEnd(value: unknown, of: Kind): number | null {
  if (of === 'dateTime' || of === 'integer') return isInteger(value) ? value : null;
  if (of === 'number') return isRealNumber(value) ? value : null;
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
 * An end in the user's format for its kind, a numeric one as its `of` type's summary without the unit.
 */
function formatEnd(ms: number, field: DashboardField<RangeFieldOptions>): string {
  const of = kindOf(field);
  if (of === 'integer' || of === 'number') {
    return endType(of).summary!(ms, { ...field, options: { currency: field.options?.currency } });
  }
  if (of === 'date') return formatDate(ms);
  if (of === 'time') return formatTime(ms);
  return formatDateTime(ms, field.options?.timezone as string | undefined);
}

/**
 * A range as one line of text, or `undefined` when an end is malformed.
 * An `open` end that is `null` reads as the range's start alone.
 */
function rangeText(value: unknown, field: DashboardField<RangeFieldOptions>): string | undefined {
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

/**
 * The field type a numeric range's ends hold.
 */
function endType(of: 'integer' | 'number'): FieldType<IntegerFieldOptions> {
  return of === 'integer' ? integerType : numberType;
}

/**
 * The control of a numeric range: an `integer` or `number` control per end, side by side.
 * Each end parses, steps, and checks its own text against `min`, `max`, `step`, and `currency`.
 * The pair adds the empty ends, the span check, and each end's name after the field label.
 * Under `display: 'slider'` a two-thumb track above the inputs edits the same text.
 * Its thumbs stay `minSpan` to `maxSpan` apart.
 */
function numericControl(
  context: FieldControlContext<RangeFieldOptions>,
  of: 'integer' | 'number',
): FieldControl {
  const { field, initial, path, disabled, language, onInput } = context;
  const t = useT();
  const { step, currency, suffix, display, open = false } = field.options ?? {};
  const { min, max, minSpan, maxSpan } = (field.options ?? {}) as Partial<Record<Bound, number>>;
  let base = initial;
  const touched = ref(false);
  const routed = ref('');
  const touch = (): void => {
    touched.value = true;
    routed.value = '';
    onInput();
  };

  const end = (key: 'start' | 'end', placeholder: Text): FieldControl =>
    endType(of).control!({
      ...context,
      field: {
        ...field,
        nullable: true,
        placeholder,
        options: { min, max, step, currency, suffix },
      },
      initial: endOf(base, key),
      onInput: touch,
    })!;
  const ends = [
    end('start', field.placeholder ?? 'dashboard.range.start'),
    end('end', open ? 'dashboard.range.noEnd' : 'dashboard.range.end'),
  ] as const;
  const inputs = ends.map(
    (control) => (control.element as HTMLElement).querySelector('input') as HTMLInputElement,
  );

  const ids = controlIDs(path);
  inputs[1]!.id = `${ids.input}-end`;
  // A self-reference would read the input's value, so an empty start and end would sound alike.
  const names = ends.map((control, index) => {
    const id = `${ids.input}-${KEYS[index]}-name`;
    const input = inputs[index]!;
    input.setAttribute('aria-labelledby', `${ids.label} ${id}`);
    batchedEffect(() => {
      if (routed.value === '' && control.error() === '') input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
    });
    return h('span', { id, hidden: true }, () => t(`dashboard.range.${KEYS[index]!}`));
  });

  const numberOf = (control: FieldControl): number | undefined => {
    const value = control.draft!();
    return isNumber(value) ? value : undefined;
  };
  const track = (): HTMLElement | undefined => {
    if (display !== 'slider' || !isNumber(min) || !isNumber(max)) return undefined;
    const model: Ref<Ends> = {
      get value(): Ends {
        return [numberOf(ends[0]), numberOf(ends[1])];
      },
      set value(next) {
        ends.forEach((control, index) => {
          if (next[index] !== numberOf(control)) control.restore!(next[index]);
        });
        touch();
      },
    };
    const slider = sliderRange(model, {
      min,
      max,
      step,
      minRange: minSpan,
      maxRange: maxSpan,
      disabled: () => disabled === true,
      invalid: (end) => routed.value !== '' || ends[end]!.error() !== '',
    });
    for (const input of slider.querySelectorAll('input')) {
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
    }
    return slider;
  };

  const baseValue = (): unknown => (isUndefined(base) ? undefined : stored(base));
  // The value the control holds: the base's own ends while untouched, else each end as drafted.
  const current = (): unknown => {
    if (!touched.value) return baseValue();
    const [start, finish] = ends.map((control) => control.draft!() ?? null);
    return isNull(start) && isNull(finish) ? null : { start, end: finish };
  };
  const dirty = (): boolean => touched.value && !deepEqual(current(), baseValue() ?? null);
  const labelled = (key: 'start' | 'end', control: FieldControl): string => {
    const message = control.error();
    return message === '' ? '' : `${t(`dashboard.range.${key}`)}: ${message}`;
  };
  const show = (value: unknown): void => {
    ends.forEach((control, index) => control.restore!(endOf(value, KEYS[index]!)));
    routed.value = '';
  };

  return {
    element: h(
      'div',
      { class: 'ohne-range-numeric' },
      track(),
      h('div', { class: 'ohne-range-numeric-ends' }, ...ends.map((control) => control.element)),
      ...names,
    ),
    read() {
      if (!touched.value) {
        if (isUndefined(base)) return {};
        const value = baseValue();
        return isNull(value) && !field.nullable ? {} : { value };
      }
      const [start, finish] = ends.map((control) => control.read());
      if (!isUndefined(start!.errors)) return { errors: { start: start!.errors[''] ?? '' } };
      if (!isUndefined(finish!.errors)) return { errors: { end: finish!.errors[''] ?? '' } };
      const low = (start!.value ?? null) as number | null;
      const high = (finish!.value ?? null) as number | null;
      if (isNull(low) && isNull(high)) return field.nullable ? { value: null } : {};
      if (isNull(low)) return { errors: { start: translateMessage('validation.required') } };
      if (isNull(high) && !open) {
        return { errors: { end: translateMessage('validation.required') } };
      }
      const amount = isCurrencyCode(currency)
        ? (minor: number) => formatCurrencyIn(minor, currency, language())
        : undefined;
      const failure =
        isNull(high) || !dirty()
          ? undefined
          : checkNumberSpan(low, high, { min: minSpan, max: maxSpan }, amount);
      return checkedReading(current(), failure);
    },
    draft() {
      return !touched.value && isUndefined(base) ? undefined : current();
    },
    setErrors(errors) {
      const { '': own, start, end: finish } = errors;
      ends[0].setErrors({ '': start ?? '' });
      ends[1].setErrors({ '': finish ?? '' });
      // Set last, so the pair's `aria-invalid` effect runs after the ends' own and is not cleared by them.
      routed.value = own ?? '';
      for (const [key, message] of Object.entries(errors)) {
        if (key !== '' && key !== 'start' && key !== 'end') return message;
      }
      return '';
    },
    error: () => routed.value || labelled('start', ends[0]) || labelled('end', ends[1]),
    dirty,
    focus() {
      inputs[0]!.focus();
    },
    revert() {
      show(base);
      touched.value = false;
    },
    rebase(value) {
      base = value;
      ends.forEach((control, index) => control.rebase(endOf(value, KEYS[index]!)));
      touched.value = false;
      routed.value = '';
    },
    restore(value) {
      show(isUndefined(value) ? base : value);
      touched.value = !isUndefined(value);
    },
  };
}

/**
 * One end of a stored range as given, `undefined` when the range holds none.
 */
function endOf(value: unknown, key: 'start' | 'end'): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

registerFieldType('range', rangeType);
