import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `checkbox`.
 */
export interface CheckboxOptions {
  /**
   * Swaps the check mark for a minus reactively while it returns `true`.
   * The mark shows only while the model is `true`, so pair it with a truthy model.
   */
  indeterminate?: () => boolean;

  /**
   * The fill of the checked box.
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
   * While it returns `true` the box border, fill, and focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the checkbox reactively while it returns `true`.
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

  /**
   * Muted description text rendered under the label.
   */
  description?: Child | (() => Child);

  /**
   * Called after a toggle with the new value and the native `change` event.
   */
  onChange?: (value: boolean, event: Event) => void;
}

css`
  .ohne-checkbox {
    display: inline-flex;
    gap: 0.625em;
    max-width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-checkbox-has-content {
    width: 100%;
  }

  .ohne-checkbox + .ohne-checkbox {
    margin-top: 0.625em;
  }

  .ohne-checkbox-control {
    display: none;
  }

  .ohne-checkbox-button {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: calc(1em + 0.125rem);
    height: calc(1em + 0.125rem);
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: transparent;
  }

  .ohne-checkbox-button:not(:last-child) {
    margin-top: calc(0.25em - 0.0625rem);
  }

  .ohne-checkbox-primary .ohne-checkbox-control[data-checked='true'] + .ohne-checkbox-button {
    background-color: hsl(var(--ohne-primary));
    border-color: transparent;
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-checkbox-accent .ohne-checkbox-control[data-checked='true'] + .ohne-checkbox-button {
    background-color: hsl(var(--ohne-accent));
    border-color: transparent;
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-checkbox-has-errors .ohne-checkbox-button {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-checkbox-has-errors .ohne-checkbox-control[data-checked='true'] + .ohne-checkbox-button {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-checkbox-button:focus-visible {
    border-color: transparent;
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-checkbox-disabled,
  .ohne-checkbox-disabled .ohne-checkbox-label {
    cursor: not-allowed;
  }

  .ohne-checkbox-disabled .ohne-checkbox-button,
  .ohne-checkbox-disabled .ohne-checkbox-control[data-checked='true'] + .ohne-checkbox-button {
    background-color: hsl(var(--ohne-muted));
    border-color: hsl(var(--ohne-input));
    pointer-events: none;
  }

  .ohne-checkbox-disabled .ohne-checkbox-control[data-checked='true'] + .ohne-checkbox-button {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-checkbox-content {
    flex: 1;
  }

  .ohne-checkbox-label {
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
  }

  .ohne-checkbox-description {
    font-size: calc(1em - 0.125rem);
    color: hsl(var(--ohne-muted-foreground));
  }
`;

let sequence = 0;

/**
 * The check mark, or a minus while indeterminate, drawn at full stroke width.
 */
function markIcon(indeterminate: boolean): SVGSVGElement {
  const mark = icon(indeterminate ? 'minus' : 'check');
  mark.classList.add('ohne-stroke-2');
  mark.setAttribute('width', '0.875em');
  mark.setAttribute('height', '0.875em');
  return mark;
}

/**
 * A styled checkbox: a hidden native input behind a proxy button, with optional label and description.
 * The button and the label both toggle the input.
 * The model follows its `change` events, and writing the model updates the box.
 * The check flips instantly - only the switch animates.
 *
 * @example
 * ```ts
 * const published = ref(false)
 * checkbox(published, 'Published')
 * ```
 */
export function checkbox(
  model: Ref<boolean>,
  label?: Child | (() => Child),
  options: CheckboxOptions = {},
): HTMLElement {
  const variant = options.variant ?? 'primary';
  const localId = options.id ?? `ohne-checkbox-${++sequence}`;
  const hasContent = !isUndefined(label) || !isUndefined(options.description);
  const input = h('input', {
    'data-checked': () => String(model.value),
    id: localId,
    name: options.name,
    hidden: true,
    type: 'checkbox',
    class: 'ohne-checkbox-control',
    onChange: (event: Event) => {
      model.value = input.checked;
      options.onChange?.(input.checked, event);
    },
  }) as HTMLInputElement;
  batchedEffect(() => {
    input.checked = model.value;
  });
  return h(
    'div',
    {
      class: () =>
        `ohne-checkbox ohne-checkbox-${variant}` +
        (hasContent ? ' ohne-checkbox-has-content' : '') +
        (options.error?.() ? ' ohne-checkbox-has-errors' : '') +
        (options.disabled?.() ? ' ohne-checkbox-disabled' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    input,
    h(
      'button',
      {
        'aria-checked': () => String(model.value),
        disabled: options.disabled,
        role: 'checkbox',
        type: 'button',
        class: 'ohne-checkbox-button ohne-raw',
        onClick: () => input.click(),
      },
      () => markIcon(options.indeterminate?.() ?? false),
    ),
    hasContent
      ? h(
          'div',
          { class: 'ohne-checkbox-content' },
          isUndefined(label)
            ? null
            : h(
                'label',
                {
                  for: localId,
                  class: 'ohne-checkbox-label',
                  onClick: (event: MouseEvent) => {
                    if (options.disabled?.()) event.preventDefault();
                  },
                },
                label,
              ),
          isUndefined(options.description)
            ? null
            : h('div', { class: 'ohne-checkbox-description' }, options.description),
        )
      : null,
  );
}
