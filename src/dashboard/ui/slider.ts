import type { Ref } from '../../utils/reactive/ref.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { countDecimals } from '../../utils/number/count-decimals.ts';
import { roundTo } from '../../utils/number/round-to.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `slider`.
 */
export interface SliderOptions {
  /**
   * The value at the left end of the track.
   */
  min: number;

  /**
   * The value at the right end of the track.
   */
  max: number;

  /**
   * The distance between the values the thumb stops at, counted from `min`.
   *
   * @default
   * 1
   */
  step?: number;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Disables the slider reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the range input.
   */
  id?: string;

  /**
   * The `name` attribute of the range input.
   */
  name?: string;
}

css`
  .ohne-slider {
    --ohne-slider-thumb: 1.125em;
    --ohne-slider-track: 0.375em;
    display: flex;
    align-items: center;
    width: 100%;
    height: calc(2em + 0.25rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-slider-input {
    width: 100%;
    height: var(--ohne-slider-thumb);
    margin: 0;
    background: transparent;
    cursor: pointer;
    touch-action: pan-y;
    appearance: none;
  }

  .ohne-slider-input:focus-visible {
    outline: none;
  }

  .ohne-slider-input::-webkit-slider-runnable-track {
    height: var(--ohne-slider-track);
    border-radius: 9999px;
    background: var(--ohne-slider-fill);
  }

  .ohne-slider-input::-moz-range-track {
    height: var(--ohne-slider-track);
    border-radius: 9999px;
    background: var(--ohne-slider-fill);
  }

  .ohne-slider-input::-webkit-slider-thumb {
    width: var(--ohne-slider-thumb);
    height: var(--ohne-slider-thumb);
    margin-top: calc((var(--ohne-slider-track) - var(--ohne-slider-thumb)) / 2);
    background-color: hsl(var(--ohne-card));
    border: 0.125rem solid hsl(var(--ohne-primary));
    border-radius: 50%;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, opacity;
    appearance: none;
  }

  .ohne-slider-input::-moz-range-thumb {
    box-sizing: border-box;
    width: var(--ohne-slider-thumb);
    height: var(--ohne-slider-thumb);
    background-color: hsl(var(--ohne-card));
    border: 0.125rem solid hsl(var(--ohne-primary));
    border-radius: 50%;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, opacity;
  }

  .ohne-slider-input:focus-visible::-webkit-slider-thumb {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
  }

  .ohne-slider-input:focus-visible::-moz-range-thumb {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
  }

  @media (hover: hover) {
    .ohne-slider-input:enabled:hover::-webkit-slider-thumb {
      background-color: hsl(var(--ohne-primary));
    }

    .ohne-slider-input:enabled:hover::-moz-range-thumb {
      background-color: hsl(var(--ohne-primary));
    }
  }

  .ohne-slider[data-dragging] .ohne-slider-input::-webkit-slider-thumb {
    background-color: hsl(var(--ohne-primary));
    box-shadow: 0 0 0 0.375rem hsl(var(--ohne-primary) / 0.15);
  }

  .ohne-slider[data-dragging] .ohne-slider-input::-moz-range-thumb {
    background-color: hsl(var(--ohne-primary));
    box-shadow: 0 0 0 0.375rem hsl(var(--ohne-primary) / 0.15);
  }

  .ohne-slider[data-empty='true'] .ohne-slider-input::-webkit-slider-thumb {
    opacity: 0.5;
  }

  .ohne-slider[data-empty='true'] .ohne-slider-input::-moz-range-thumb {
    opacity: 0.5;
  }

  .ohne-slider-input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

/**
 * A range track on the native `input type="range"`, so keyboard, pointer, and `role=slider` come built in.
 * The model follows every move, rounded to the grid's decimals, and writing it moves the thumb.
 * An `undefined` model rests the thumb at `min`, dimmed, with an empty track.
 * The filled part of the track ends under the thumb's center.
 * The thumb fills on hover and, from press to release, wears a halo.
 *
 * @example
 * ```ts
 * const volume = ref<number | undefined>(40)
 * slider(volume, { min: 0, max: 100, step: 5 })
 * ```
 */
export function slider(model: Ref<number | undefined>, options: SliderOptions): HTMLElement {
  const { min, max, step = 1 } = options;
  const places = Math.max(countDecimals(min), countDecimals(step));
  const input = h('input', {
    type: 'range',
    id: options.id,
    name: options.name,
    min: String(min),
    max: String(max),
    step: String(step),
    disabled: options.disabled,
    class: 'ohne-slider-input',
    onInput: () => {
      model.value = roundTo(Number(input.value), places);
    },
    onPointerdown: () => {
      if (options.disabled?.() === true) return;
      root.setAttribute('data-dragging', 'true');
      const release = (): void => {
        root.removeAttribute('data-dragging');
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    },
  }) as HTMLInputElement;
  const root = h(
    'div',
    {
      class: 'ohne-slider',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    input,
  );
  batchedEffect(() => {
    const value = model.value;
    const empty = isUndefined(value);
    const at = empty ? min : clamp(value, min, max);
    const ratio = max > min ? (at - min) / (max - min) : 0;
    const stop = `calc(var(--ohne-slider-thumb) / 2 + (100% - var(--ohne-slider-thumb)) * ${ratio})`;
    input.value = String(at);
    root.setAttribute('data-empty', String(empty));
    input.style.setProperty(
      '--ohne-slider-fill',
      empty
        ? 'hsl(var(--ohne-border))'
        : `linear-gradient(to right, hsl(var(--ohne-primary)) ${stop}, hsl(var(--ohne-border)) ${stop})`,
    );
  });
  return root;
}
