import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { coerceToString } from '../../utils/coerce/coerce-to-string.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { mirrorWidth } from './mirror-width.ts';
import './tokens.ts';

/**
 * Options for `textInput`.
 */
export interface TextInputOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * The input type.
   * A getter reads reactively, so a suffix button can reveal a password by flipping it.
   *
   * @default
   * 'text'
   */
  type?: string | (() => string);

  /**
   * Placeholder text shown while the input is empty.
   * A getter reads reactively, so a translated placeholder resolves when its catalog lands.
   */
  placeholder?: string | (() => string);

  /**
   * The minimum number of characters the input accepts.
   */
  minLength?: number;

  /**
   * The maximum number of characters the input accepts.
   */
  maxLength?: number;

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
   * The `autocomplete` attribute of the input element.
   *
   * @default
   * 'off'
   */
  autocomplete?: string;

  /**
   * The `spellcheck` attribute of the input element.
   *
   * @default
   * false
   */
  spellcheck?: boolean;

  /**
   * The `autofocus` attribute of the input element.
   *
   * @default
   * false
   */
  autofocus?: boolean;

  /**
   * Sizes the box to its content, measured through a hidden mirror span.
   *
   * @default
   * false
   */
  autoWidth?: boolean;

  /**
   * Content rendered inside the border box, before the input.
   */
  prefix?: Child | (() => Child);

  /**
   * Content rendered inside the border box, after the input.
   */
  suffix?: Child | (() => Child);

  /**
   * Called when the input gains focus, with the value at that moment.
   */
  onFocus?: (event: FocusEvent, value: string) => void;

  /**
   * Called when the input loses focus, with the value at that moment.
   */
  onBlur?: (event: FocusEvent, value: string) => void;
}

css`
  .ohne-input {
    --ohne-base-size: var(--ohne-size);
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

  .ohne-input:not(.ohne-input-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-input-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-input-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-input-auto-width {
    position: relative;
    flex-shrink: 0;
    width: fit-content;
  }

  .ohne-input-numeric {
    font-variant-numeric: tabular-nums;
  }

  .ohne-input-control {
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

  .ohne-input-control::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-input-shadow {
    position: absolute;
    bottom: 0;
    left: 0;
    width: auto;
    height: 0;
    white-space: pre;
    visibility: hidden;
  }

  .ohne-input > .ohne-button {
    --ohne-size: calc(var(--ohne-base-size) - 1);
    width: calc(2em + 0.125rem);
    height: calc(2em + 0.125rem);
    margin-right: 0.125rem;
    margin-left: 0.125rem;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-input > :not(.ohne-input-control, .ohne-button) {
    flex-shrink: 0;
    margin-right: 0.5em;
    margin-left: 0.5em;
  }
`;

/**
 * A single-line text input: a bordered box that takes an inner ring on focus.
 * The prefix and suffix render inside the box; a nested `button` steps down one size to fit.
 * Typing writes into the model; writing the model updates the input.
 * Escape blurs the input without bubbling, and double-clicks stop at the box.
 * `ohne-input-numeric` on the box renders the value in tabular numerals.
 * With `autoWidth` the box hugs its content, measured through a hidden mirror span.
 *
 * @example
 * ```ts
 * const email = ref('')
 * textInput(email, { type: 'email', placeholder: 'you@example.com' })
 * ```
 */
export function textInput(model: Ref<string>, options: TextInputOptions = {}): HTMLElement {
  const input = h('input', {
    autocomplete: options.autocomplete ?? 'off',
    autofocus: options.autofocus ?? false,
    disabled: options.disabled,
    id: options.id,
    maxlength: options.maxLength,
    minlength: options.minLength,
    name: options.name,
    placeholder: options.placeholder,
    spellcheck: coerceToString(options.spellcheck ?? false),
    type: options.type ?? 'text',
    class: 'ohne-input-control',
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    model.value = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  });
  if (options.onFocus) {
    const onFocus = options.onFocus;
    input.addEventListener('focus', (event) => onFocus(event, input.value));
  }
  if (options.onBlur) {
    const onBlur = options.onBlur;
    input.addEventListener('blur', (event) => onBlur(event, input.value));
  }
  batchedEffect(() => {
    if (input.value !== model.value) input.value = model.value;
  });
  let shadow: HTMLElement | null = null;
  if (options.autoWidth) {
    const placeholder = (): string | undefined =>
      isFunction(options.placeholder) ? options.placeholder() : options.placeholder;
    shadow = h(
      'span',
      { class: 'ohne-input-control ohne-input-shadow' },
      () => model.value || placeholder(),
    );
    mirrorWidth(input, shadow);
  }
  return h(
    'div',
    {
      class: () =>
        'ohne-input' +
        (options.autoWidth ? ' ohne-input-auto-width' : '') +
        (options.error?.() ? ' ohne-input-has-errors' : '') +
        (options.disabled?.() ? ' ohne-input-disabled' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    options.prefix,
    input,
    shadow,
    options.suffix,
  );
}
