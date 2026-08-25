import type { Ref } from '../../utils/reactive/ref.ts';

import { isNullish } from '../../utils/is/is-nullish.ts';
import { isString } from '../../utils/is/is-string.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { bubble } from './bubble.ts';
import { type Primitive } from './button-group.ts';
import { icon, type IconName } from './icon.ts';
import { attachTooltip } from './tooltip.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * One choice in an `iconGroup`.
 */
export interface IconGroupChoice {
  /**
   * The value of the choice in the icon group.
   * It must be unique among the choices in the group.
   */
  value: Primitive;

  /**
   * The icon to display for the choice: a Tabler icon name, or a ready node.
   */
  icon?: IconName | Node;

  /**
   * Text set as the `title` HTML attribute of the choice element.
   * With `showTooltips` enabled, it appears as a styled tooltip on hover instead.
   */
  title?: string;

  /**
   * An optional bubble to display on the top right corner of the icon.
   */
  bubble?: IconGroupBubble;
}

/**
 * The corner bubble of an `IconGroupChoice`.
 */
export interface IconGroupBubble {
  /**
   * The content of the bubble, read reactively when given as a getter.
   */
  content: string | (() => string);

  /**
   * The visual style variant of the bubble.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive';

  /**
   * A tooltip to display when hovering over the bubble.
   */
  tooltip?: string;
}

/**
 * Options for `iconGroup`.
 */
export interface IconGroupOptions {
  /**
   * The choices to display in the icon group, read reactively.
   */
  choices: () => IconGroupChoice[];

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
   * Shows each choice's `title` as a styled tooltip on hover instead of the `title` attribute.
   *
   * @default
   * false
   */
  showTooltips?: boolean;

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the active item turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the icon group reactively while it returns `true`.
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
}

css`
  .ohne-icon-group {
    flex-shrink: 0;
    display: inline-flex;
    gap: 0.125rem;
    max-width: 100%;
    height: calc(2em + 0.25rem);
    padding: 0.125rem;
    overflow-x: auto;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-icon-group-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-icon-group:focus-visible,
  .ohne-icon-group-focus-visible {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-icon-group-disabled {
    pointer-events: none;
  }

  .ohne-icon-group-item {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    aspect-ratio: 1;
    cursor: pointer;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-icon-group-primary .ohne-icon-group-item-active {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-icon-group-primary .ohne-icon-group-item:not(.ohne-icon-group-item-active):hover {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-icon-group-accent .ohne-icon-group-item-active {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-icon-group-accent .ohne-icon-group-item:not(.ohne-icon-group-item-active):hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-icon-group-has-errors .ohne-icon-group-item-active {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-icon-group-disabled .ohne-icon-group-item {
    color: hsl(var(--ohne-muted-foreground) / 0.64);
    font-weight: 400;
  }

  .ohne-icon-group-disabled .ohne-icon-group-item-active {
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-icon-group-icon {
    width: 1em;
    height: 1em;
    font-size: calc(1em + 0.125rem);
  }

  .ohne-icon-group .ohne-bubble {
    position: absolute;
    border: none;
    transform: translate(1.125em, -1.125em);
  }
`;

/**
 * A `buttonGroup` variant with square icon cells and an optional per-choice corner bubble.
 * Arrow keys step through the choices and clamp at the edges; Space cycles with wraparound.
 * A trailing hidden input carries `id` and `name`, so label linkage and form serialization work.
 * A `focus:<id>` trigger focuses the group and shows the ring.
 * `:focus-visible` cannot match a programmatic focus.
 *
 * @example
 * ```ts
 * const device = ref<Primitive>('desktop')
 * iconGroup(device, {
 *   choices: () => [
 *     { value: 'desktop', icon: 'device-desktop', title: 'Desktop' },
 *     { value: 'clock', icon: 'clock', title: 'Scheduled' },
 *   ],
 * })
 * ```
 */
export function iconGroup(model: Ref<Primitive>, options: IconGroupOptions): HTMLElement {
  const focusVisible = ref(false);

  const step = (offset: number, loop: boolean): void => {
    const choices = options.choices();
    if (choices.length === 0) return;
    const index = choices.findIndex((choice) => choice.value === model.value);
    // The source crashes when the value is absent from the choices; landing on the first
    // choice recovers instead, matching the library's own `fallback` semantics.
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
        `ohne-icon-group ohne-icon-group-${options.variant ?? 'primary'}` +
        (options.error?.() ? ' ohne-icon-group-has-errors' : '') +
        (options.disabled?.() ? ' ohne-icon-group-disabled' : '') +
        (focusVisible.value ? ' ohne-icon-group-focus-visible' : ''),
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
      (choice) => {
        const item = h(
          'span',
          {
            title: options.showTooltips ? undefined : () => choice().title,
            class: () =>
              'ohne-icon-group-item' +
              (choice().value === model.value ? ' ohne-icon-group-item-active' : ''),
            onClick: () => {
              model.value = choice().value;
            },
          },
          () => choiceIcon(choice().icon),
          () => choiceBubble(choice().bubble),
        );
        if (options.showTooltips) onCleanup(attachTooltip(item, () => choice().title ?? null));
        return item;
      },
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

function choiceIcon(shape: IconName | Node | undefined): Node | null {
  if (shape === undefined) return null;
  const node = isString(shape) ? icon(shape) : shape;
  if (node instanceof Element) node.classList.add('ohne-icon-group-icon');
  return node;
}

function choiceBubble(model: IconGroupBubble | undefined): Node | null {
  if (model === undefined) return null;
  const pill = bubble(model.content, { variant: model.variant });
  if (model.tooltip !== undefined) onCleanup(attachTooltip(pill, model.tooltip));
  return pill;
}
