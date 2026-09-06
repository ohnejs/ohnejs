import type { Ref } from '../../utils/reactive/ref.ts';
import type { CalendarLabels } from './calendar.ts';
import type { IconName } from './icon.ts';

import { isNumber } from '../../utils/is/is-number.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { parseDateTime, parseTimeSpan } from './calendar-date.ts';
import { calendar } from './calendar.ts';
import './tokens.ts';

/**
 * Options for `calendarRange`.
 */
export interface CalendarRangeOptions {
  /**
   * The initial year and month shown when either calendar opens.
   * A timestamp in milliseconds or an ISO 8601 formatted date.
   * Omitted, each calendar starts on its current value, falling back to the current year and month.
   *
   * @default
   * null
   */
  initial?: number | string | null;

  /**
   * Whether the calendars include time selection.
   * When disabled, every emitted timestamp is midnight in the resolved time zone.
   *
   * @default
   * false
   */
  withTime?: boolean;

  /**
   * Whether the time pickers show the seconds segment.
   *
   * @default
   * true
   */
  showSeconds?: boolean;

  /**
   * The IANA time zone the calendars display dates in, or `'local'` for the environment's zone.
   *
   * @default
   * 'local'
   */
  timezone?: string;

  /**
   * Formats the selected timestamps for display in the handles.
   *
   * @default
   * (timestamp) => new Date(timestamp).toUTCString()
   */
  formatter?: (timestamp: number) => string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Placeholder text shown while the start value is `null`.
   */
  placeholderFrom?: string;

  /**
   * Placeholder text shown while the end value is `null`.
   */
  placeholderTo?: string;

  /**
   * Whether the clear buttons render while a value is selected.
   *
   * @default
   * true
   */
  clearable?: boolean;

  /**
   * The icon in the start calendar's handle: a Tabler icon name, an element, or `null` for none.
   *
   * @default
   * 'calendar-down'
   */
  iconFrom?: IconName | Element | null;

  /**
   * The icon in the end calendar's handle: a Tabler icon name, an element, or `null` for none.
   *
   * @default
   * 'calendar-up'
   */
  iconTo?: IconName | Element | null;

  /**
   * The minimum selectable date: a timestamp in milliseconds or an ISO 8601 string.
   *
   * @default
   * -59011459200000
   */
  min?: number | string;

  /**
   * The maximum selectable date: a timestamp in milliseconds or an ISO 8601 string.
   *
   * @default
   * 8640000000000000
   */
  max?: number | string;

  /**
   * Minimum time span between the start and end dates.
   * Milliseconds, a jose-style duration string like `'1 hour'`, or a span object.
   *
   * @default
   * 0
   */
  minRange?:
    | number
    | string
    | { days?: number; hours?: number; minutes?: number; seconds?: number };

  /**
   * Maximum time span between the start and end dates.
   * Milliseconds, a jose-style duration string like `'1 day'`, or a span object.
   * `null` means no limit.
   *
   * @default
   * null
   */
  maxRange?:
    | number
    | string
    | { days?: number; hours?: number; minutes?: number; seconds?: number }
    | null;

  /**
   * Reports the error state of both inputs reactively.
   */
  error?: () => boolean;

  /**
   * Disables both inputs reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The base `id` of the hidden input elements; the calendars append `--1` and `--2`.
   */
  id?: string;

  /**
   * The base `name` of the hidden input elements; the calendars append `--1` and `--2`.
   */
  name?: string;

  /**
   * The starting day of the week, `0` (Sunday) to `6` (Saturday).
   *
   * @default
   * 1
   */
  startDay?: number;

  /**
   * Labels used for the calendar components.
   */
  labels?: CalendarLabels;

  /**
   * The position of the bracket decorator connecting the two inputs.
   *
   * @default
   * 'left'
   */
  decorator?: 'left' | 'right' | 'hidden';

  /**
   * Called with the settled tuple when either picker closes, and immediately on clear.
   */
  onCommit?: (value: [number | null, number | null]) => void;
}

css`
  .ohne-calendar-range {
    position: relative;
    width: 100%;
    max-width: 100%;
  }

  .ohne-calendar-range-decorator-left {
    padding-left: 1em;
  }

  .ohne-calendar-range-decorator-right {
    padding-right: 1em;
  }

  .ohne-calendar-range > .ohne-calendar:nth-child(2) {
    margin-top: 0.5em;
  }

  .ohne-calendar-range-decorator {
    position: absolute;
    top: calc(1em - 0.03125rem);
    bottom: calc(1em - 0.03125rem);
    width: 0.5em;
    border-width: 1px;
    border-color: hsl(var(--ohne-muted-foreground) / 0.36);
  }

  .ohne-calendar-range-decorator-left .ohne-calendar-range-decorator {
    left: 0;
    border-right: none;
    border-top-left-radius: calc(var(--ohne-radius) - 0.25rem);
    border-bottom-left-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-calendar-range-decorator-right .ohne-calendar-range-decorator {
    right: 0;
    border-left: none;
    border-top-right-radius: calc(var(--ohne-radius) - 0.25rem);
    border-bottom-right-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-calendar-range-decorator-hidden .ohne-calendar-range-decorator {
    display: none;
  }
`;

/**
 * The date range picker.
 *
 * Two stacked calendars share one `[from, to]` tuple model and constrain each other:
 * `minRange` keeps the ends apart even against the global bounds, `maxRange` caps the span.
 * An absolute bracket decorator ties the two inputs together on the left or right edge.
 * `commit` fires with the settled tuple when either picker closes, and immediately on clear.
 *
 * @example
 * ```ts
 * const window = ref<[number | null, number | null]>([null, null])
 * calendarRange(window, { minRange: '1 day', maxRange: '30 days' })
 * ```
 */
export function calendarRange(
  model: Ref<[number | null, number | null]>,
  options: CalendarRangeOptions = {},
): HTMLElement {
  const min = parseDateTime(options.min ?? -59011459200000);
  const max = parseDateTime(options.max ?? 8640000000000000);
  const minRange = parseTimeSpan(options.minRange ?? 0);
  const maxRange =
    options.maxRange === null || options.maxRange === undefined
      ? null
      : parseTimeSpan(options.maxRange);

  const minFrom = (): number => {
    const to = model.value[1];
    return isNumber(to) && isNumber(maxRange) ? Math.max(to - maxRange, min) : min;
  };
  const maxFrom = (): number => (model.value[1] ?? max) - minRange;
  const minTo = (): number => (model.value[0] ?? min) + minRange;
  const maxTo = (): number => {
    const from = model.value[0];
    return isNumber(from) && isNumber(maxRange) ? Math.min(from + maxRange, max) : max;
  };

  const fromModel: Ref<number | null> = {
    get value() {
      return model.value[0] ?? null;
    },
    set value(next) {
      model.value = [next, untracked(() => model.value[1])];
    },
  };
  const toModel: Ref<number | null> = {
    get value() {
      return model.value[1];
    },
    set value(next) {
      model.value = [untracked(() => model.value[0]), next];
    },
  };

  const shared = {
    clearable: options.clearable,
    disabled: options.disabled,
    error: options.error,
    formatter: options.formatter,
    initial: options.initial,
    labels: options.labels,
    showSeconds: options.showSeconds,
    startDay: options.startDay,
    timezone: options.timezone,
    withTime: options.withTime,
  };

  return h(
    'div',
    {
      class: `ohne-calendar-range ohne-calendar-range-decorator-${options.decorator ?? 'left'}`,
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    calendar(fromModel, {
      ...shared,
      icon: options.iconFrom === undefined ? 'calendar-down' : options.iconFrom,
      id: options.id ? `${options.id}--1` : undefined,
      name: options.name ? `${options.name}--1` : undefined,
      min: minFrom,
      max: maxFrom,
      placeholder: options.placeholderFrom,
      onCommit: (value) => options.onCommit?.([value, untracked(() => model.value[1])]),
    }),
    calendar(toModel, {
      ...shared,
      icon: options.iconTo === undefined ? 'calendar-up' : options.iconTo,
      id: options.id ? `${options.id}--2` : undefined,
      name: options.name ? `${options.name}--2` : undefined,
      min: minTo,
      max: maxTo,
      placeholder: options.placeholderTo,
      onCommit: (value) => options.onCommit?.([untracked(() => model.value[0]), value]),
    }),
    h('span', { class: 'ohne-calendar-range-decorator' }),
  );
}
