import type { Ref } from '../../utils/reactive/ref.ts';
import type { SliderOptions } from './slider.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { countDecimals } from '../../utils/number/count-decimals.ts';
import { roundTo } from '../../utils/number/round-to.ts';
import { stepValue } from '../../utils/number/step-value.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { markDrag, trackStop } from './slider.ts';
import './tokens.ts';

/**
 * Options for `sliderRange`.
 */
export interface SliderRangeOptions extends Omit<SliderOptions, 'id' | 'name' | 'invalid'> {
  /**
   * The smallest gap the thumbs keep, a multiple of `step`.
   *
   * @default
   * 0
   */
  minRange?: number;

  /**
   * The largest gap the thumbs keep, a multiple of `step`.
   *
   * @default
   * Infinity
   */
  maxRange?: number;

  /**
   * Marks a thumb as errored while it returns `true` for its end, `0` the start and `1` the end.
   */
  invalid?: (end: 0 | 1) => boolean;
}

type Ends = [number | undefined, number | undefined];

css`
  .ohne-slider-range {
    position: relative;
    cursor: pointer;
    touch-action: pan-y;
  }

  .ohne-slider-range::before {
    content: '';
    position: absolute;
    inset: 0;
    height: var(--ohne-slider-track);
    margin: auto 0;
    border-radius: 9999px;
    background: var(--ohne-slider-fill);
  }

  .ohne-slider-range:has(> :disabled) {
    cursor: not-allowed;
  }

  .ohne-slider-range:has(> :disabled)::before {
    opacity: 0.5;
  }

  .ohne-slider-range > .ohne-slider-input {
    position: absolute;
    inset: 0;
    margin: auto 0;
    pointer-events: none;
  }

  .ohne-slider-range > .ohne-slider-input[data-raised] {
    z-index: 1;
  }

  /* The root paints the track, so the top input's track cannot cut through the lower thumb. */
  .ohne-slider-range > .ohne-slider-input::-webkit-slider-runnable-track {
    background: none;
  }

  .ohne-slider-range > .ohne-slider-input::-moz-range-track {
    background: none;
  }

  .ohne-slider-range > .ohne-slider-input::-webkit-slider-thumb {
    pointer-events: auto;
  }

  .ohne-slider-range > .ohne-slider-input::-moz-range-thumb {
    pointer-events: auto;
  }
`;

/**
 * A two-thumb `slider` over one track, editing a start and an end.
 * Each thumb is a native `input type="range"`, so keyboard and `role=slider` come built in.
 * A thumb stops at the gap limits instead of crossing or pushing the other one.
 * A press on the track moves the nearer thumb there and drags it until release.
 * An `undefined` start rests at `min` and an `undefined` end at `max`.
 * The last thumb moved sits on top, unless the thumbs meet at an end of the track.
 *
 * @example
 * ```ts
 * const price = ref<[number | undefined, number | undefined]>([100, 400])
 * sliderRange(price, { min: 0, max: 1000, step: 50, minRange: 100 })
 * ```
 */
export function sliderRange(model: Ref<Ends>, options: SliderRangeOptions): HTMLElement {
  const { min, max, step = 1, minRange = 0, maxRange = Infinity } = options;
  const places = Math.max(countDecimals(min), countDecimals(step));
  const off = (): boolean => options.disabled?.() === true;
  let raised: 0 | 1 = 1;

  const move = (end: 0 | 1, value: number): void => {
    const next: Ends = [...model.value];
    const other = next[1 - end];
    next[end] = isUndefined(other)
      ? value
      : clamp(
          roundTo(
            end === 0
              ? clamp(value, other - maxRange, other - minRange)
              : clamp(value, other + minRange, other + maxRange),
            places,
          ),
          min,
          max,
        );
    raised = end;
    model.value = next;
    // A model that skips an unchanged value never reruns the effect, so the thumb snaps back here.
    thumbs[end].value = String(at(model.value)[end]);
  };

  const thumb = (end: 0 | 1): HTMLInputElement => {
    const input = h('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      disabled: options.disabled,
      class: 'ohne-slider-input',
      onInput: () => move(end, roundTo(Number(input.value), places)),
      onPointerdown: () => {
        if (off()) return;
        raised = end;
        stack();
        markDrag(input);
      },
    }) as HTMLInputElement;
    return input;
  };
  const thumbs = [thumb(0), thumb(1)] as const;

  const at = ([start, end]: Ends): [number, number] => [
    isUndefined(start) ? min : clamp(start, min, max),
    isUndefined(end) ? max : clamp(end, min, max),
  ];
  const stack = (): void => {
    const [start, end] = at(model.value);
    const top = start === end && start === max ? 0 : start === end && end === min ? 1 : raised;
    thumbs[top].setAttribute('data-raised', 'true');
    thumbs[top === 0 ? 1 : 0].removeAttribute('data-raised');
  };
  const pick = (x: number): number => {
    const box = root.getBoundingClientRect();
    const size = thumbs[0].getBoundingClientRect().height;
    const ratio = clamp((x - box.left - size / 2) / (box.width - size), 0, 1);
    return stepValue(min + ratio * (max - min) + step / 2, 0, { min, max, step });
  };

  const root = h(
    'div',
    {
      class: 'ohne-slider ohne-slider-range',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onPointerdown: (event: PointerEvent) => {
        if (off() || event.target !== root) return;
        const value = pick(event.clientX);
        const [start, end] = at(model.value);
        const nearer =
          Math.abs(value - start) < Math.abs(value - end) || (start === end && value < start)
            ? 0
            : 1;
        move(nearer, value);
        markDrag(thumbs[nearer], (drag) => move(nearer, pick(drag.clientX)));
      },
    },
    ...thumbs,
  );

  batchedEffect(() => {
    const ends = model.value;
    const stops = at(ends);
    thumbs.forEach((input, index) => {
      input.value = String(stops[index]);
    });
    const [from, to] = stops.map((value) => trackStop(value, min, max));
    root.style.setProperty(
      '--ohne-slider-fill',
      ends.every(isUndefined)
        ? 'hsl(var(--ohne-border))'
        : `linear-gradient(to right, hsl(var(--ohne-border)) ${from}, hsl(var(--ohne-primary)) ${from}, ` +
            `hsl(var(--ohne-primary)) ${to}, hsl(var(--ohne-border)) ${to})`,
    );
    stack();
  });
  thumbs.forEach((input, index) => {
    batchedEffect(() => {
      if (options.invalid?.(index as 0 | 1) === true) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  });
  return root;
}
