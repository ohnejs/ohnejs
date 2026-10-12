import type { RGBA } from '../../utils/color/rgba.ts';
import type { Ref } from '../../utils/reactive/ref.ts';

import { formatHexColor } from '../../utils/color/format-hex-color.ts';
import { parseHexColor } from '../../utils/color/parse-hex-color.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { numberInput } from './number-input.ts';
import { textInput } from './text-input.ts';

/**
 * The accessible labels of a `colorInput`.
 */
export interface ColorInputLabels {
  /**
   * The label of the button that opens the system color picker.
   * A getter reads reactively.
   *
   * @default
   * 'Pick a color'
   */
  pick?: string | (() => string);

  /**
   * The label of the opacity input.
   * A getter reads reactively.
   *
   * @default
   * 'Opacity'
   */
  opacity?: string | (() => string);
}

/**
 * Options for `colorInput`.
 */
export interface ColorInputOptions {
  /**
   * Whether the color may be translucent, with an opacity input beside the hex.
   *
   * @default
   * false
   */
  alpha?: boolean;

  /**
   * Colors offered under the input, in any hex spelling.
   */
  swatches?: readonly string[];

  /**
   * The hex input's placeholder; a getter reads reactively.
   */
  placeholder?: string | (() => string);

  /**
   * Reactive disabled state, for every part of the input.
   */
  disabled?: () => boolean;

  /**
   * The hex input's `id`, so a `fieldLabel` can target it.
   */
  id?: string;

  /**
   * The hex input's form `name`.
   */
  name?: string;

  /**
   * The accessible labels of the picker button and the opacity input.
   */
  labels?: ColorInputLabels;
}

css`
  .ohne-color-chip {
    position: relative;
    flex-shrink: 0;
    display: inline-block;
    width: 1em;
    height: 1em;
    overflow: hidden;
    background-size: 0.5em;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    box-shadow: inset 0 0 0 1px hsl(var(--ohne-foreground) / 0.16);
    vertical-align: middle;
  }

  .ohne-color-chip > span {
    position: absolute;
    inset: 0;
  }

  .ohne-color-picker {
    position: relative;
    display: flex;
  }

  .ohne-color-picker > input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .ohne-color-picker > input:disabled {
    cursor: not-allowed;
  }

  .ohne-color-picker:has(> input:focus-visible) > .ohne-color-chip {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-color-input {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ohne-color-values {
    display: flex;
    gap: 0.5rem;
  }

  .ohne-color-values > .ohne-input {
    flex: 1;
    min-width: 0;
  }

  .ohne-color-values > .ohne-number {
    flex: 0 0 6.5rem;
  }

  .ohne-color-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .ohne-color-swatch {
    display: flex;
    padding: 0;
    font-size: 1.5rem;
    background: none;
    border: none;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    cursor: pointer;
  }

  .ohne-color-swatch:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .ohne-color-swatch:focus-visible,
  .ohne-color-swatch[aria-pressed='true'] {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
    outline: none;
  }
`;

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };

/**
 * A color as its canonical hex, or `undefined` when `value` is no hex color.
 *
 * @example
 * ```ts
 * canonicalColor('#F80')   // -> '#ff8800'
 * canonicalColor('orange') // -> undefined
 * ```
 */
export function canonicalColor(value: unknown): string | undefined {
  const color = isString(value) ? parseHexColor(value) : undefined;
  return isUndefined(color) ? undefined : formatHexColor(color);
}

/**
 * A small square of a color over the transparency grid; `transparent` shows the bare grid.
 *
 * @example
 * ```ts
 * colorChip(() => '#ff880080')
 * ```
 */
export function colorChip(color: () => string): HTMLElement {
  return h(
    'span',
    { class: 'ohne-color-chip ohne-checkerboard' },
    h('span', { style: () => `background-color: ${color()}` }),
  );
}

/**
 * A hex color input: the hex as text, with the system color picker behind the chip in front of it.
 * With `alpha`, an opacity input beside it sets the alpha channel; without, every pick is opaque.
 * The opacity applies only to a valid color, clamped to `0`-`100`, so it never writes a broken hex.
 * With `swatches`, a row of colors under it, the one the model holds marked.
 * An opaque swatch keeps the chosen opacity, so it stays marked while only the opacity differs.
 * Typing writes the model as typed; the picker, the opacity, and a swatch write the canonical hex.
 *
 * @example
 * ```ts
 * const tint = ref('#ff8800')
 * colorInput(tint, { alpha: true, swatches: ['#0070dd', '#a335ee'] })
 * ```
 */
export function colorInput(model: Ref<string>, options: ColorInputOptions = {}): HTMLElement {
  const alpha = options.alpha === true;
  const disabled = (): boolean => options.disabled?.() === true;
  const parsed = (): RGBA | undefined => parseHexColor(model.value);
  const paint = (color: RGBA): void => {
    model.value = formatHexColor(alpha ? color : { ...color, a: 255 });
  };

  const picker = h('input', {
    type: 'color',
    disabled,
    'aria-label': () => toValue(options.labels?.pick ?? 'Pick a color'),
  }) as HTMLInputElement;
  effect(() => {
    picker.value = formatHexColor({ ...(parsed() ?? BLACK), a: 255 });
  });
  picker.addEventListener('input', () => {
    paint({ ...parseHexColor(picker.value)!, a: parsed()?.a ?? 255 });
  });
  const hex = textInput(model, {
    id: options.id,
    name: options.name,
    disabled,
    placeholder: options.placeholder,
    spellcheck: false,
    prefix: h(
      'span',
      { class: 'ohne-color-picker' },
      colorChip(() => canonicalColor(model.value) ?? 'transparent'),
      picker,
    ),
  });

  const opacityInput = (): HTMLElement => {
    const opacity: Ref<number> = {
      get value() {
        return Math.round(((parsed()?.a ?? 255) / 255) * 100);
      },
      set value(next) {
        const color = parsed();
        if (isUndefined(color) || !isRealNumber(next)) return;
        const a = Math.round((clamp(next, 0, 100) / 100) * 255);
        if (a !== color.a) paint({ ...color, a });
      },
    };
    const element = numberInput(opacity, { min: 0, max: 100, suffix: '%', disabled });
    const number = element.querySelector('input') as HTMLInputElement;
    effect(() => number.setAttribute('aria-label', toValue(options.labels?.opacity ?? 'Opacity')));
    return element;
  };

  const swatches = (options.swatches ?? []).flatMap((swatch) => {
    const color = parseHexColor(swatch);
    return isUndefined(color) ? [] : [color];
  });
  const holds = (swatch: RGBA): boolean => {
    const color = parsed();
    if (isUndefined(color) || color.r !== swatch.r || color.g !== swatch.g) return false;
    return color.b === swatch.b && (swatch.a === 255 || color.a === swatch.a);
  };
  const swatchRow = (): HTMLElement =>
    h(
      'div',
      { class: 'ohne-color-swatches' },
      swatches.map((swatch) => {
        const value = formatHexColor(swatch);
        return h(
          'button',
          {
            type: 'button',
            class: 'ohne-color-swatch ohne-raw',
            disabled,
            title: value,
            'aria-label': value,
            'aria-pressed': () => String(holds(swatch)),
            onClick: () => paint(swatch.a === 255 ? { ...swatch, a: parsed()?.a ?? 255 } : swatch),
          },
          colorChip(() => value),
        );
      }),
    );

  return h(
    'div',
    { class: 'ohne-color-input' },
    h('div', { class: 'ohne-color-values' }, hex, alpha ? opacityInput() : null),
    swatches.length > 0 ? swatchRow() : null,
  );
}
