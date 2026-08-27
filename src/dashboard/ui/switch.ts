import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `switchInput`.
 */
export interface SwitchOptions {
  /**
   * The fill of the checked track.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'accent';

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Reports the error state reactively.
   * While it returns `true` the track and the focus ring turn destructive, in both states.
   */
  error?: () => boolean;

  /**
   * Disables the switch reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input, linking the label to it.
   * Omitted generates a unique one.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input.
   */
  name?: string;
}

css`
  .ohne-switch {
    display: flex;
    align-items: center;
    gap: 0.625em;
    width: 100%;
    max-width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-switch + .ohne-switch {
    margin-top: 0.625em;
  }

  .ohne-switch-control {
    display: none;
  }

  .ohne-switch-button {
    flex-shrink: 0;
    display: flex;
    width: calc(2em + 0.5rem);
    height: calc(1em + 0.375rem);
    padding: 0.125rem;
    background-color: hsl(var(--ohne-border));
    border-radius: 2em;
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow;
  }

  .ohne-switch-button::after {
    content: '';
    width: calc(1em + 0.125rem);
    height: calc(1em + 0.125rem);
    border-radius: 50%;
    background-color: hsl(var(--ohne-card));
    transition: var(--ohne-transition);
    transition-property: transform;
  }

  .ohne-switch-primary .ohne-switch-control[data-checked='true'] + .ohne-switch-button {
    background-color: hsl(var(--ohne-primary));
  }

  .ohne-switch-accent .ohne-switch-control[data-checked='true'] + .ohne-switch-button {
    background-color: hsl(var(--ohne-accent));
  }

  .ohne-switch-control[data-checked='true'] + .ohne-switch-button::after {
    transform: translateX(100%);
  }

  .ohne-switch-has-errors .ohne-switch-button {
    --ohne-ring: var(--ohne-destructive);
  }

  .ohne-switch-has-errors .ohne-switch-control[data-checked] + .ohne-switch-button {
    background-color: hsl(var(--ohne-destructive));
  }

  .ohne-switch-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-switch-disabled,
  .ohne-switch-disabled .ohne-switch-label {
    cursor: not-allowed;
  }

  /* A deviation from the source, which leaves a disabled track lit: it mutes, as a disabled input does. */
  .ohne-switch-disabled .ohne-switch-button,
  .ohne-switch-disabled .ohne-switch-control[data-checked='true'] + .ohne-switch-button {
    background-color: hsl(var(--ohne-muted));
    pointer-events: none;
  }

  .ohne-switch-label {
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
  }
`;

let sequence = 0;

/**
 * A toggle switch: the checkbox's hidden-input-and-proxy-button pattern with an animated knob.
 * The track and the label both toggle the input.
 * The model follows its `change` events, and writing the model slides the knob.
 * Space on the focused track toggles too - there is no drag support.
 *
 * @example
 * ```ts
 * const published = ref(false)
 * switchInput(published, 'Published')
 * ```
 */
export function switchInput(
  model: Ref<boolean>,
  label?: Child | (() => Child),
  options: SwitchOptions = {},
): HTMLElement {
  const variant = options.variant ?? 'primary';
  const localId = options.id ?? `ohne-switch-${++sequence}`;
  const input = h('input', {
    'data-checked': () => String(model.value),
    id: localId,
    name: options.name,
    hidden: true,
    type: 'checkbox',
    class: 'ohne-switch-control',
    onChange: () => {
      model.value = input.checked;
    },
  }) as HTMLInputElement;
  batchedEffect(() => {
    input.checked = model.value;
  });
  return h(
    'div',
    {
      class: () =>
        `ohne-switch ohne-switch-${variant}` +
        (options.error?.() ? ' ohne-switch-has-errors' : '') +
        (options.disabled?.() ? ' ohne-switch-disabled' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    input,
    h('button', {
      'aria-checked': () => String(model.value),
      disabled: options.disabled,
      role: 'switch',
      type: 'button',
      class: 'ohne-switch-button ohne-raw',
      onClick: () => input.click(),
    }),
    isUndefined(label)
      ? null
      : h(
          'label',
          {
            for: localId,
            class: 'ohne-switch-label',
            onClick: (event: MouseEvent) => {
              if (options.disabled?.()) event.preventDefault();
            },
          },
          label,
        ),
  );
}
