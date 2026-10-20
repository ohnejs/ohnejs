import type { ComputedRef } from '../../utils/reactive/computed.ts';
import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { button } from './button.ts';
import { icon } from './icon.ts';
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
   * A getter reads reactively.
   *
   * @default
   * 'h'
   */
  hoursSuffix?: string | (() => string);

  /**
   * The suffix displayed after the minutes input.
   * A getter reads reactively.
   *
   * @default
   * 'm'
   */
  minutesSuffix?: string | (() => string);

  /**
   * The suffix displayed after the seconds input.
   * A getter reads reactively.
   *
   * @default
   * 's'
   */
  secondsSuffix?: string | (() => string);

  /**
   * The title of the clear button.
   * A getter reads reactively.
   *
   * @default
   * 'Clear'
   */
  clear?: string | (() => string);
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
   * Shows a clear button while the model holds a time, writing `null` when pressed.
   *
   * @default
   * false
   */
  clearable?: boolean;

  /**
   * Suffix labels of the segment inputs, and the clear button's title.
   */
  labels?: TimeLabels;

  /**
   * Called with the composed value in ms whenever a segment settles.
   * A segment settles on Enter, blur, an arrow key step, or a stepper click.
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

  .ohne-time-inner > .ohne-time-clear {
    color: inherit;
  }

  /* One invalid segment marks the whole time, as one value. */
  :where(.ohne-time:has([aria-invalid='true'])) .ohne-number {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }
`;

/**
 * A 24-hour time-of-day input over three `numberInput` segments (hh:mm:ss).
 * The model holds ms within a day, an integer between `0` (00:00:00) and `86399000` (23:59:59).
 * Segment bounds cascade from `min` and `max`, and a settled segment clamps the composed value into them.
 * A trailing hidden input carries `id`, `name`, and the composed value for label linkage and forms.
 * A `null` model shows every segment empty; typing into one composes the time from `min`.
 *
 * @example
 * ```ts
 * const value = ref(43200000)
 * time(value, { min: '09:00', max: '17:00', onCommit: save })
 * ```
 */
export function time(model: Ref<number | null>, options: TimeOptions = {}): HTMLElement {
  const disabled = (): boolean => options.disabled?.() ?? false;
  const showSeconds = options.showSeconds ?? true;
  const resolve = (bound: number | string | (() => number | string)): number =>
    parseTime(isFunction<() => number | string>(bound) ? bound() : bound);
  const min = computed(() => resolve(options.min ?? 0));
  const max = computed(() => resolve(options.max ?? 86399000));
  const at = (): number => model.value ?? min.value;
  const bounds = computed(() => timeSegmentBounds(at(), min.value, max.value));
  const part = (read: (ms: number) => number) =>
    computed(() => (isNull(model.value) ? null : read(model.value)));
  const hours = part((ms) => Math.floor(ms / 1000 / 3600));
  const minutes = part((ms) => Math.floor(((ms / 1000) % 3600) / 60));
  const seconds = part((ms) => Math.floor((ms / 1000) % 60));
  const hour = (): number => Math.floor(at() / 1000 / 3600);
  const minute = (): number => Math.floor(((at() / 1000) % 3600) / 60);
  const second = (): number => Math.floor((at() / 1000) % 60);

  const toModelValue = (hours: number, minutes: number, seconds: number): number =>
    composeTime(hours, minutes, seconds, 0, 86399000);

  const settle = (): void => {
    if (isNull(model.value)) return;
    model.value = clamp(model.value, min.value, max.value);
    options.onCommit?.(model.value);
  };

  const segment = (
    part: ComputedRef<number | null>,
    write: (value: number) => number,
  ): Ref<number | null> => ({
    get value() {
      return part.value;
    },
    set value(next) {
      if (!isNull(next)) model.value = write(next);
    },
  });

  const resolveLabel = (label: string | (() => string) | undefined, fallback: string): string =>
    (isFunction<() => string>(label) ? label() : label) ?? fallback;

  const clear = (): Child =>
    options.clearable === true && !isNull(model.value) && !disabled()
      ? button(icon('x'), {
          variant: 'ghost',
          iconOnly: true,
          size: -2,
          class: 'ohne-time-clear',
          ariaLabel: () => resolveLabel(options.labels?.clear, 'Clear'),
          onClick: () => {
            model.value = null;
          },
        })
      : null;

  const root = h(
    'div',
    {
      class: () => 'ohne-time' + (disabled() ? ' ohne-time-disabled' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    h(
      'div',
      { class: 'ohne-time-inner' },
      numberInput(
        segment(hours, (value) => toModelValue(value, minute(), second())),
        {
          disabled: options.disabled,
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
          onCommit: settle,
        },
      ),
      h('span', null, ':'),
      numberInput(
        segment(minutes, (value) => toModelValue(hour(), value, second())),
        {
          disabled: options.disabled,
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
          onCommit: settle,
        },
      ),
      showSeconds ? h('span', null, ':') : null,
      showSeconds
        ? numberInput(
            segment(seconds, (value) => toModelValue(hour(), minute(), value)),
            {
              disabled: options.disabled,
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
              onCommit: settle,
            },
          )
        : null,
      clear,
    ),
    h('input', {
      id: options.id,
      name: options.name,
      value: () => model.value ?? '',
      hidden: true,
    }),
  );

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (disabled()) return;
      root.querySelector<HTMLInputElement>('.ohne-number-input')?.focus();
    });
  }

  return root;
}
