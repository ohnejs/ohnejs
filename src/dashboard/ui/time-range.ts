import type { Ref } from '../../utils/reactive/ref.ts';
import type { TimeSpanValue } from './time-model.ts';
import type { TimeLabels } from './time.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { parseTimeSpan } from './calendar-date.ts';
import { parseTime, timeRangeBounds } from './time-model.ts';
import { time } from './time.ts';
import './tokens.ts';

/**
 * Options for `timeRange`.
 */
export interface TimeRangeOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * The minimum selectable time: ms within a day, or an ISO 8601 time string like `'01:00:00'`.
   * A getter reads reactively, so a bound can follow another control.
   *
   * @default
   * 0
   */
  min?: number | string | (() => number | string);

  /**
   * The maximum selectable time: ms within a day, or an ISO 8601 time string like `'02:00:00'`.
   * A getter reads reactively, so a bound can follow another control.
   *
   * @default
   * 86399000
   */
  max?: number | string | (() => number | string);

  /**
   * The minimum time span between start and end:
   * ms, a duration string like `'30 minutes'`, or a parts object like `{ hours: 1 }`.
   * A getter reads reactively.
   *
   * @default
   * 0
   */
  minRange?: TimeSpanValue | (() => TimeSpanValue);

  /**
   * The maximum time span between start and end:
   * ms, a duration string like `'2 hours'`, or a parts object like `{ hours: 2 }`.
   * A getter reads reactively.
   *
   * @default
   * 86399000
   */
  maxRange?: TimeSpanValue | (() => TimeSpanValue);

  /**
   * Reports the error state reactively.
   * While it returns `true` the borders and the focus rings turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the inputs reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The base `id` attribute; the two `time` inputs take `<id>--1` and `<id>--2`.
   * A `fieldLabel` for `<id>--1` focuses the start input through the trigger bus.
   */
  id?: string;

  /**
   * The base `name` attribute; the two hidden inputs take `<name>--1` and `<name>--2`.
   */
  name?: string;

  /**
   * Specifies whether to show the seconds inputs.
   *
   * @default
   * true
   */
  showSeconds?: boolean;

  /**
   * Suffix labels of the segment inputs, forwarded to both `time` inputs.
   */
  labels?: TimeLabels;

  /**
   * The position of the decorator that connects the two inputs.
   *
   * @default
   * 'left'
   */
  decorator?: 'left' | 'right' | 'hidden';

  /**
   * Called with the replaced `[from, to]` tuple in ms whenever a segment settles.
   */
  onCommit?: (value: [number, number]) => void;
}

css`
  .ohne-time-range {
    position: relative;
    width: 100%;
    max-width: 100%;
  }

  .ohne-time-range-decorator-left {
    padding-left: 1em;
  }

  .ohne-time-range-decorator-right {
    padding-right: 1em;
  }

  .ohne-time-range > .ohne-time:nth-child(2) {
    margin-top: 0.5em;
  }

  .ohne-time-range-decorator {
    position: absolute;
    top: calc(1em - 0.03125rem);
    bottom: calc(1em - 0.03125rem);
    width: 0.5em;
    border-width: 1px;
    border-color: hsl(var(--ohne-muted-foreground) / 0.36);
  }

  .ohne-time-range-decorator-left .ohne-time-range-decorator {
    left: 0;
    border-right: none;
    border-top-left-radius: calc(var(--ohne-radius) - 0.25rem);
    border-bottom-left-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-time-range-decorator-right .ohne-time-range-decorator {
    right: 0;
    border-left: none;
    border-top-right-radius: calc(var(--ohne-radius) - 0.25rem);
    border-bottom-right-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-time-range-decorator-hidden .ohne-time-range-decorator {
    display: none;
  }
`;

/**
 * Two stacked `time` inputs with mutual bounds, ported from PUITimeRange.
 * The model holds a `[from, to]` tuple of ms within a day, each between `0` and `86399000`.
 * Each side's bounds derive from the other side, `min`/`max`, and `minRange`/`maxRange`.
 * A side decorator visually connects the two inputs.
 *
 * @example
 * ```ts
 * const range = ref<[number, number]>([32400000, 61200000])
 * timeRange(range, { minRange: '30 minutes', onCommit: save })
 * ```
 */
export function timeRange(
  model: Ref<[number, number]>,
  options: TimeRangeOptions = {},
): HTMLElement {
  const resolveTime = (bound: number | string | (() => number | string)): number =>
    parseTime(isFunction<() => number | string>(bound) ? bound() : bound);
  const resolveSpan = (span: TimeSpanValue | (() => TimeSpanValue)): number =>
    parseTimeSpan(isFunction<() => TimeSpanValue>(span) ? span() : span);
  const min = computed(() => resolveTime(options.min ?? 0));
  const max = computed(() => resolveTime(options.max ?? 86399000));
  const minRange = computed(() => resolveSpan(options.minRange ?? 0));
  const maxRange = computed(() => resolveSpan(options.maxRange ?? 86399000));
  const bounds = computed(() =>
    timeRangeBounds(model.value, min.value, max.value, minRange.value, maxRange.value),
  );

  const side = (index: 0 | 1): Ref<number> => ({
    get value() {
      return model.value[index];
    },
    set value(next) {
      model.value = index === 0 ? [next, model.value[1]] : [model.value[0], next];
    },
  });

  return h(
    'div',
    {
      class: `ohne-time-range ohne-time-range-decorator-${options.decorator ?? 'left'}`,
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    time(side(0), {
      disabled: options.disabled,
      error: options.error,
      id: options.id ? `${options.id}--1` : undefined,
      labels: options.labels,
      min: () => bounds.value.minFrom,
      max: () => bounds.value.maxFrom,
      name: options.name ? `${options.name}--1` : undefined,
      showSeconds: options.showSeconds,
      onCommit: (value) => options.onCommit?.([value, model.value[1]]),
    }),
    time(side(1), {
      disabled: options.disabled,
      error: options.error,
      id: options.id ? `${options.id}--2` : undefined,
      labels: options.labels,
      min: () => bounds.value.minTo,
      max: () => bounds.value.maxTo,
      name: options.name ? `${options.name}--2` : undefined,
      showSeconds: options.showSeconds,
      onCommit: (value) => options.onCommit?.([model.value[0], value]),
    }),
    h('span', { class: 'ohne-time-range-decorator' }),
  );
}
