import type { ComputedRef } from '../../utils/reactive/computed.ts';
import type { Ref } from '../../utils/reactive/ref.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { numberInput } from './number-input.ts';
import { composeTime, parseTime, timeSegmentBounds } from './time-model.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * Suffix labels of the `time` segment inputs.
 */
export interface TimeLabels {
  /**
   * The suffix displayed after the hours input.
   *
   * @default
   * 'h'
   */
  hoursSuffix?: string;

  /**
   * The suffix displayed after the minutes input.
   *
   * @default
   * 'm'
   */
  minutesSuffix?: string;

  /**
   * The suffix displayed after the seconds input.
   *
   * @default
   * 's'
   */
  secondsSuffix?: string;
}

/**
 * Options for `time`.
 */
export interface TimeOptions {
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
   * Reports the error state reactively.
   * While it returns `true` the borders and the focus rings turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the inputs reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input element; the segment inputs take `<id>--hours` and so on.
   * A `fieldLabel` for this id focuses the hours input through the trigger bus.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input element that holds the composed value.
   * The segment inputs take `<name>--hours` and so on.
   */
  name?: string;

  /**
   * Specifies whether to show the seconds input.
   *
   * @default
   * true
   */
  showSeconds?: boolean;

  /**
   * Suffix labels of the segment inputs.
   */
  labels?: TimeLabels;

  /**
   * Called with the composed value in ms whenever a segment settles:
   * after blur, arrow key steps, and stepper clicks.
   */
  onCommit?: (value: number) => void;
}

css`
  .ohne-time {
    width: 100%;
    max-width: 100%;
  }

  .ohne-time-inner {
    display: flex;
    align-items: center;
    gap: 0.25em;
  }

  .ohne-time-inner > span {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * A 24-hour time-of-day input over three `numberInput` segments (hh:mm:ss), ported from PUITime.
 * The model holds ms within a day, an integer between `0` (00:00:00) and `86399000` (23:59:59).
 * Segment bounds cascade from `min` and `max`, and every write clamps the composed value into them.
 * A trailing hidden input carries `id`, `name`, and the composed value for label linkage and forms.
 *
 * @example
 * ```ts
 * const value = ref(43200000)
 * time(value, { min: '09:00', max: '17:00', onCommit: save })
 * ```
 */
export function time(model: Ref<number>, options: TimeOptions = {}): HTMLElement {
  const disabled = (): boolean => options.disabled?.() ?? false;
  const showSeconds = options.showSeconds ?? true;
  const resolve = (bound: number | string | (() => number | string)): number =>
    parseTime(isFunction<() => number | string>(bound) ? bound() : bound);
  const min = computed(() => resolve(options.min ?? 0));
  const max = computed(() => resolve(options.max ?? 86399000));
  const bounds = computed(() => timeSegmentBounds(model.value, min.value, max.value));
  const hours = computed(() => Math.floor(model.value / 1000 / 3600));
  const minutes = computed(() => Math.floor(((model.value / 1000) % 3600) / 60));
  const seconds = computed(() => Math.floor((model.value / 1000) % 60));

  const toModelValue = (hours: number, minutes: number, seconds: number): number =>
    composeTime(hours, minutes, seconds, min.value, max.value);

  const segment = (part: ComputedRef<number>, write: (value: number) => number): Ref<number> => ({
    get value() {
      return part.value;
    },
    set value(next) {
      model.value = write(next);
    },
  });

  const root = h(
    'div',
    {
      class: () =>
        'ohne-time' +
        (options.error?.() ? ' ohne-time-has-errors' : '') +
        (disabled() ? ' ohne-time-disabled' : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    h(
      'div',
      { class: 'ohne-time-inner' },
      numberInput(
        segment(hours, (value) => toModelValue(value, minutes.value, seconds.value)),
        {
          disabled: options.disabled,
          error: options.error,
          id: options.id ? `${options.id}--hours` : undefined,
          get min() {
            return bounds.value.minHours;
          },
          get max() {
            return bounds.value.maxHours;
          },
          name: options.name ? `${options.name}--hours` : undefined,
          padZeros: 2,
          showSteppers: true,
          suffix: options.labels?.hoursSuffix ?? 'h',
          onCommit: (value) =>
            options.onCommit?.(toModelValue(value, minutes.value, seconds.value)),
        },
      ),
      h('span', null, ':'),
      numberInput(
        segment(minutes, (value) => toModelValue(hours.value, value, seconds.value)),
        {
          disabled: options.disabled,
          error: options.error,
          id: options.id ? `${options.id}--minutes` : undefined,
          get min() {
            return bounds.value.minMinutes;
          },
          get max() {
            return bounds.value.maxMinutes;
          },
          name: options.name ? `${options.name}--minutes` : undefined,
          padZeros: 2,
          showSteppers: true,
          suffix: options.labels?.minutesSuffix ?? 'm',
          onCommit: (value) => options.onCommit?.(toModelValue(hours.value, value, seconds.value)),
        },
      ),
      showSeconds ? h('span', null, ':') : null,
      showSeconds
        ? numberInput(
            segment(seconds, (value) => toModelValue(hours.value, minutes.value, value)),
            {
              disabled: options.disabled,
              error: options.error,
              id: options.id ? `${options.id}--seconds` : undefined,
              get min() {
                return bounds.value.minSeconds;
              },
              get max() {
                return bounds.value.maxSeconds;
              },
              name: options.name ? `${options.name}--seconds` : undefined,
              padZeros: 2,
              showSteppers: true,
              suffix: options.labels?.secondsSuffix ?? 's',
              onCommit: (value) =>
                options.onCommit?.(toModelValue(hours.value, minutes.value, value)),
            },
          )
        : null,
    ),
    h('input', { id: options.id, name: options.name, value: () => model.value, hidden: true }),
  );

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (disabled()) return;
      root.querySelector<HTMLInputElement>('.ohne-number-input')?.focus();
    });
  }

  return root;
}
