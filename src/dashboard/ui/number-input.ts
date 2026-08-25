import type { Ref } from '../../utils/reactive/ref.ts';

import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `numberInput`.
 */
export interface NumberInputOptions {
  /**
   * The minimum value the input can settle on.
   * Omitted means no lower bound.
   */
  min?: number;

  /**
   * The maximum value the input can settle on.
   * Omitted means no upper bound.
   */
  max?: number;

  /**
   * The number of decimal places a settled value keeps.
   *
   * @default
   * 0
   */
  decimalPlaces?: number;

  /**
   * The total number of integer digits to pad with leading zeros, so `4` renders 42 as `0042`.
   * `0` disables padding.
   *
   * @default
   * 0
   */
  padZeros?: number;

  /**
   * The amount one arrow key step, stepper click, or drag pixel adds.
   * Shift multiplies it by 10.
   *
   * @default
   * 1
   */
  increment?: number;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Placeholder text shown while the input is empty.
   */
  placeholder?: string;

  /**
   * Plain text rendered after the value, inside the border box.
   */
  suffix?: string;

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the input reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the input element.
   */
  id?: string;

  /**
   * The `name` attribute of the input element.
   */
  name?: string;

  /**
   * Sizes the input to its content, measured through a hidden mirror span.
   *
   * @default
   * false
   */
  autoWidth?: boolean;

  /**
   * Shows the drag button, which adjusts the value one increment per pixel dragged.
   *
   * @default
   * false
   */
  showDragButton?: boolean;

  /**
   * Shows the stepper buttons.
   *
   * @default
   * false
   */
  showSteppers?: boolean;

  /**
   * The axis the drag button moves along.
   * Horizontal drags increase rightward, vertical drags increase upward.
   *
   * @default
   * 'horizontal'
   */
  dragDirection?: 'horizontal' | 'vertical';

  /**
   * The accessibility label of the drag button.
   *
   * @default
   * 'Drag to adjust value'
   */
  ariaDragLabel?: string;

  /**
   * Called with each settled value: after blur, arrow key steps, stepper clicks, and drag end.
   * Plain typing only writes the model.
   */
  onCommit?: (value: number) => void;
}

css`
  .ohne-number {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: calc(2em + 0.25rem);
    overflow: hidden;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-number:focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-number-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-number-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    box-shadow: none;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-number-icon {
    position: absolute;
    top: 50%;
    left: 0.5em;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1em;
    height: 1em;
    margin-top: -0.5em;
    overflow: hidden;
    outline: none;
    color: hsl(var(--ohne-foreground));
  }

  .ohne-number-disabled .ohne-number-icon {
    pointer-events: none;
  }

  .ohne-number-icon-horizontal {
    cursor: ew-resize;
  }

  .ohne-number-icon-vertical {
    cursor: ns-resize;
  }

  .ohne-number-disabled .ohne-number-icon {
    cursor: default;
  }

  .ohne-number-input {
    display: flex;
    width: 100%;
    height: 100%;
    padding: 0 0.5em;
    overflow: hidden;
    background-color: transparent;
    border: none;
    outline: none;
    font-size: 1em;
    line-height: 1.25;
    color: hsl(var(--ohne-foreground));
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-number-has-drag-button .ohne-number-input {
    padding-left: 2em;
  }

  .ohne-number-input::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-number-input-shadow {
    position: absolute;
    bottom: 0;
    left: 0;
    display: inline-flex;
    width: auto;
    height: 0;
    padding-top: 0;
    padding-bottom: 0;
    white-space: pre;
    visibility: hidden;
  }

  .ohne-number-steppers {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    margin-right: 0.5em;
    font-size: calc(1em - 0.125rem);
  }

  .ohne-number-disabled .ohne-number-steppers {
    pointer-events: none;
  }

  .ohne-number-steppers > button {
    outline: none;
    color: hsl(var(--ohne-foreground));
  }

  .ohne-number-steppers > button:disabled {
    color: hsl(var(--ohne-muted-foreground) / 0.64);
  }

  .ohne-number-suffix {
    flex-shrink: 0;
    margin-right: 0.5em;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(0.875rem + var(--ohne-size) * 0.125rem);
    white-space: nowrap;
  }

  .ohne-number-auto-width .ohne-number-suffix {
    margin-bottom: -0.1625em;
    margin-bottom: round(-0.1625em, 1px);
  }
`;

function leadingZeros(value: number, width: number): string {
  if (width <= 0) return value.toString();
  const [integer = '', decimals] = Math.abs(value).toString().split('.');
  const sign = value < 0 ? '-' : '';
  return sign + integer.padStart(width, '0') + (decimals === undefined ? '' : `.${decimals}`);
}

/**
 * A numeric input over a text field with its own display string.
 * Arrow keys, optional steppers, and an optional drag button step the value by `increment`;
 * Shift multiplies a step by 10, and Escape blurs, or ends a drag.
 * Typing writes the model on every valid number; blur, steps, and drag end settle the value -
 * clamped to the bounds, rounded to `decimalPlaces`, zero-padded - and report it to `onCommit`.
 * Writing the model reformats the display.
 *
 * With `autoWidth` the input hugs its content, re-measured through a hidden mirror span whenever
 * it resizes and after an `ohne-overlay-animated` window event, so widths measured while an
 * overlay animates get fixed.
 *
 * @example
 * ```ts
 * const amount = ref(0)
 * numberInput(amount, { min: 0, showSteppers: true, suffix: 'px' })
 * ```
 */
export function numberInput(model: Ref<number>, options: NumberInputOptions = {}): HTMLElement {
  const decimalPlaces = options.decimalPlaces ?? 0;
  const padZeros = options.padZeros ?? 0;
  const increment = options.increment ?? 1;
  const dragDirection = options.dragDirection ?? 'horizontal';
  const disabled = (): boolean => options.disabled?.() ?? false;
  const stringified = ref('');

  effect(() => {
    stringified.value = leadingZeros(model.value, padZeros);
  });

  const numericValue = (): number =>
    /[0-9,. ]/.test(stringified.value)
      ? // Only the first comma becomes a dot, as in the original.
        +stringified.value.replace(',', '.').replace(/ +/g, '')
      : +stringified.value;

  const maybeEmit = (commit = false): void => {
    const value = +stringified.value;
    if (stringified.value.trim() && isRealNumber(value)) {
      model.value = value;
      if (commit) options.onCommit?.(value);
    }
  };

  const normalize = (): boolean => {
    const value = numericValue();
    if (stringified.value.trim() && isRealNumber(value)) {
      const bounded = clamp(value, options.min ?? -Infinity, options.max ?? Infinity);
      const rounded = Math.round(bounded * 10 ** decimalPlaces) / 10 ** decimalPlaces;
      stringified.value = leadingZeros(rounded, padZeros);
      return true;
    }
    return false;
  };

  const add = (amount: number): void => {
    const value = numericValue();
    if (isRealNumber(value)) stringified.value = leadingZeros(value + amount, padZeros);
  };

  const step = (amount: number): void => {
    add(amount);
    normalize();
    maybeEmit(true);
  };

  const input = h('input', {
    disabled: options.disabled,
    id: options.id,
    name: options.name,
    placeholder: options.placeholder,
    type: 'text',
    class: 'ohne-number-input',
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    stringified.value = input.value;
    maybeEmit();
  });
  input.addEventListener('blur', () => {
    if (normalize()) maybeEmit(true);
    else stringified.value = leadingZeros(model.value, padZeros);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      step(direction * (event.shiftKey ? 10 : 1) * increment);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  });
  batchedEffect(() => {
    if (input.value !== stringified.value) input.value = stringified.value;
  });

  const dragStops: (() => void)[] = [];
  const stopDrag = (): void => {
    for (const stop of dragStops) stop();
    dragStops.length = 0;
    normalize();
    maybeEmit(true);
  };
  const pointAlongAxis = (event: MouseEvent | TouchEvent): number | undefined => {
    const point = event instanceof MouseEvent ? event : event.touches[0];
    if (point === undefined) return undefined;
    return dragDirection === 'horizontal' ? point.clientX : point.clientY;
  };
  const startDrag = (event: MouseEvent | TouchEvent): void => {
    const start = pointAlongAxis(event);
    if (start === undefined) return;
    let prev = start;
    let multiplier = 1;
    const onMove = (event: Event): void => {
      const current = pointAlongAxis(event as MouseEvent | TouchEvent);
      if (current === undefined) return;
      const delta = dragDirection === 'horizontal' ? current - prev : prev - current;
      const rounded = delta < 0 ? Math.floor(delta) : Math.ceil(delta);
      prev = current;
      add(rounded * increment * multiplier);
      normalize();
      maybeEmit();
    };
    const onKeydown = (event: Event): void => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Escape') stopDrag();
      else if (key === 'Shift') multiplier = 10;
    };
    const onKeyup = (event: Event): void => {
      if ((event as KeyboardEvent).key === 'Shift') multiplier = 1;
    };
    const track = (target: EventTarget, type: string, handler: (event: Event) => void): void => {
      target.addEventListener(type, handler);
      dragStops.push(() => target.removeEventListener(type, handler));
    };
    track(document, 'mousemove', onMove);
    track(document, 'touchmove', onMove);
    track(document, 'mouseup', stopDrag);
    track(document, 'touchend', stopDrag);
    track(window, 'keydown', onKeydown);
    track(window, 'keyup', onKeyup);
  };
  onCleanup(() => {
    for (const stop of dragStops) stop();
    dragStops.length = 0;
  });

  let shadow: HTMLElement | null = null;
  if (options.autoWidth) {
    shadow = h(
      'span',
      { class: 'ohne-number-input ohne-number-input-shadow' },
      () => stringified.value || options.placeholder,
    );
    const measured = shadow;
    const update = (): void => {
      input.style.width = `${measured.getBoundingClientRect().width}px`;
    };
    const remeasure = (): void => void setTimeout(update);
    const observer = new ResizeObserver(update);
    observer.observe(measured);
    window.addEventListener('ohne-overlay-animated', remeasure);
    window.addEventListener('resize', update);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('ohne-overlay-animated', remeasure);
      window.removeEventListener('resize', update);
    });
  }

  const dragButton = (): HTMLElement => {
    const arrow = icon(dragDirection === 'horizontal' ? 'arrows-horizontal' : 'arrows-vertical');
    arrow.classList.add('ohne-stroke-2');
    return h(
      'button',
      {
        'aria-label': options.ariaDragLabel ?? 'Drag to adjust value',
        disabled: options.disabled,
        tabindex: '-1',
        type: 'button',
        class: `ohne-number-icon ohne-number-icon-${dragDirection}`,
        onMousedown: startDrag,
        onTouchstart: (event: TouchEvent) => {
          event.preventDefault();
          startDrag(event);
        },
      },
      arrow,
    );
  };

  const steppers = (): HTMLElement =>
    h(
      'span',
      { class: 'ohne-number-steppers' },
      h(
        'button',
        {
          disabled: () => options.max !== undefined && model.value >= options.max,
          tabindex: '-1',
          type: 'button',
          class: 'ohne-raw',
          onClick: (event: MouseEvent) => step((event.shiftKey ? 10 : 1) * increment),
        },
        icon('chevron-up'),
      ),
      h(
        'button',
        {
          disabled: () => options.min !== undefined && model.value <= options.min,
          tabindex: '-1',
          type: 'button',
          class: 'ohne-raw',
          onClick: (event: MouseEvent) => step((event.shiftKey ? -10 : -1) * increment),
        },
        icon('chevron-down'),
      ),
    );

  return h(
    'div',
    {
      class: () =>
        'ohne-number' +
        (options.showDragButton && !disabled() ? ' ohne-number-has-drag-button' : '') +
        (options.autoWidth ? ' ohne-number-auto-width' : '') +
        (options.error?.() ? ' ohne-number-has-errors' : '') +
        (disabled() ? ' ohne-number-disabled' : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    when(() => (options.showDragButton ?? false) && !disabled(), dragButton),
    input,
    shadow,
    when(() => (options.showSteppers ?? false) && !disabled(), steppers),
    options.suffix ? h('span', { class: 'ohne-number-suffix' }, options.suffix) : null,
  );
}
