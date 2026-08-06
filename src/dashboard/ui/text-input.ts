import type { Ref } from '../../utils/reactive/ref.ts';

import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `textInput`.
 */
export interface TextInputOptions {
  /**
   * The input type.
   *
   * @default
   * 'text'
   */
  type?: 'text' | 'email' | 'password';

  /**
   * Placeholder text, rendered dim.
   */
  placeholder?: string;

  /**
   * Focuses the input once it is in the document.
   *
   * @default
   * false
   */
  autofocus?: boolean;

  /**
   * Called when the user presses Enter inside the input.
   */
  onEnter?: () => void;
}

css`
  .ohne-input {
    appearance: none;
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: none;
    border: none;
    border-bottom: 1px solid var(--hairline);
    color: inherit;
    font: inherit;
    padding: 4px 0;
    transition: border-color var(--pace);
  }

  .ohne-input::placeholder {
    color: var(--dim);
  }

  .ohne-input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
`;

/**
 * A Ledger text input: a bare hairline underline, accent on focus, bound two-way to `value`.
 *
 * Typing writes into the ref; writing the ref updates the input.
 * The element is returned directly, so a caller can focus or measure it.
 *
 * @example
 * ```ts
 * const email = ref('')
 * const input = textInput(email, { type: 'email', autofocus: true })
 * ```
 */
export function textInput(value: Ref<string>, options: TextInputOptions = {}): HTMLInputElement {
  const input = h('input', {
    class: 'ohne-input',
    type: options.type ?? 'text',
    placeholder: options.placeholder,
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    value.value = input.value;
  });
  if (options.onEnter) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') options.onEnter?.();
    });
  }
  batchedEffect(() => {
    if (input.value !== value.value) input.value = value.value;
  });
  if (options.autofocus) queueMicrotask(() => input.focus());
  return input;
}
