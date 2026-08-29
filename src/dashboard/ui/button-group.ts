import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { isNullish } from '../../utils/is/is-nullish.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * A selectable choice value: any primitive a group can hold and compare by identity.
 */
export type Primitive = boolean | null | number | string | undefined;

/**
 * One choice in a `buttonGroup`.
 */
export interface ButtonGroupChoice {
  /**
   * An optional label to display for the button (choice) in the group.
   * If not provided, the `value` is displayed instead.
   */
  label?: string;

  /**
   * The value of the button (choice).
   * It must be unique among the choices in the group.
   */
  value: Primitive;
}

/**
 * Options for `buttonGroup`.
 */
export interface ButtonGroupOptions {
  /**
   * The choices to display in the button group, read reactively.
   */
  choices: () => ButtonGroupChoice[];

  /**
   * The visual style variant of the buttons.
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
   * While it returns `true` the border and the active item turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the button group reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input element.
   * A `focus:<id>` trigger, dispatched by an associated field label, focuses the group.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input element that holds the selected value.
   */
  name?: string;

  /**
   * Renders one choice's content in place of the default `label || value` text.
   */
  renderChoice?: (payload: { index: number; label: string | undefined; value: Primitive }) => Child;
}

css`
  .ohne-button-group {
    flex-shrink: 0;
    display: inline-flex;
    gap: 0.125rem;
    max-width: 100%;
    height: calc(2em + 0.25rem);
    padding: 0.125rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.5;
    white-space: nowrap;
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-button-group-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-button-group:focus-visible,
  .ohne-button-group-focus-visible {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-button-group-disabled {
    pointer-events: none;
  }

  .ohne-button-group-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-width: min-content;
    height: 100%;
    padding: 0 0.5em;
    padding: 0 round(0.5em, 1px);
    cursor: pointer;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    color: hsl(var(--ohne-foreground));
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-button-group-primary .ohne-button-group-item-active {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-button-group-primary .ohne-button-group-item:not(.ohne-button-group-item-active):hover {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-group-accent .ohne-button-group-item-active {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-group-accent .ohne-button-group-item:not(.ohne-button-group-item-active):hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-button-group-has-errors .ohne-button-group-item-active {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-button-group-disabled .ohne-button-group-item {
    color: hsl(var(--ohne-muted-foreground) / 0.64);
    font-weight: 400;
  }

  .ohne-button-group-disabled .ohne-button-group-item-active {
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * A segmented single-select control in the shape of a radio group.
 * Arrow keys step through the choices and clamp at the edges; Space cycles with wraparound.
 * A trailing hidden input carries `id` and `name`, so label linkage and form serialization work.
 * A `focus:<id>` trigger focuses the group and shows the ring.
 * `:focus-visible` cannot match a programmatic focus.
 *
 * @example
 * ```ts
 * const mode = ref<Primitive>('draft')
 * buttonGroup(mode, {
 *   choices: () => [
 *     { label: 'Draft', value: 'draft' },
 *     { label: 'Published', value: 'published' },
 *   ],
 * })
 * ```
 */
export function buttonGroup(model: Ref<Primitive>, options: ButtonGroupOptions): HTMLElement {
  const focusVisible = ref(false);

  const step = (offset: number, loop: boolean): void => {
    const choices = options.choices();
    if (choices.length === 0) return;
    const index = choices.findIndex((choice) => choice.value === model.value);
    const at =
      index === -1
        ? 0
        : loop
          ? (index + offset + choices.length) % choices.length
          : clamp(index + offset, 0, choices.length - 1);
    const target = choices[at];
    if (target) model.value = target.value;
  };

  const root = h(
    'div',
    {
      role: 'group',
      tabindex: () => (options.disabled?.() ? -1 : 0),
      class: () =>
        `ohne-button-group ohne-button-group-${options.variant ?? 'primary'}` +
        (options.error?.() ? ' ohne-button-group-has-errors' : '') +
        (options.disabled?.() ? ' ohne-button-group-disabled' : '') +
        (focusVisible.value ? ' ohne-button-group-focus-visible' : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onBlur: () => {
        focusVisible.value = false;
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'ArrowLeft') step(-1, false);
        else if (event.key === 'ArrowRight') step(1, false);
        else step(1, true);
      },
    },
    each(
      () => options.choices(),
      (choice) => choice.value,
      (choice, index) =>
        h(
          'span',
          {
            class: () =>
              'ohne-button-group-item' +
              (choice().value === model.value ? ' ohne-button-group-item-active' : ''),
            onClick: () => {
              model.value = choice().value;
            },
          },
          () =>
            options.renderChoice
              ? options.renderChoice({
                  index: index(),
                  label: choice().label,
                  value: choice().value,
                })
              : displayChoice(choice()),
        ),
    ),
    h('input', {
      id: options.id,
      name: options.name,
      value: () => (isNullish(model.value) ? null : String(model.value)),
      hidden: true,
    }),
  );

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (!options.disabled?.()) {
        root.focus();
        focusVisible.value = true;
      }
    });
  }

  return root;
}

function displayChoice(choice: ButtonGroupChoice): string {
  const shown = choice.label || choice.value;
  return isNullish(shown) ? '' : String(shown);
}
