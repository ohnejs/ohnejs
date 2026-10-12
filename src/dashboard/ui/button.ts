import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';
import type { Step } from './layout.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { icon } from './icon.ts';
import { STEP_WIDTHS } from './layout.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * Options for `button`.
 */
export interface ButtonOptions {
  /**
   * The HTML tag to render.
   * Omitted renders a `<button>`, or an `<a>` when `href` is set.
   */
  is?: 'a' | 'button' | 'span';

  /**
   * The link destination; the router intercepts same-origin navigation.
   * When set, the component renders as an `<a>` unless `is` overrides the tag.
   * A getter keeps the destination live.
   */
  href?: string | (() => string);

  /**
   * The `target` attribute of the link.
   */
  target?: string;

  /**
   * The button's form role.
   * Omitted resolves to `'button'` on a `<button>` and stays unset on other tags.
   */
  type?: 'button' | 'submit' | 'reset';

  /**
   * The visual style variant of the button.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive' | 'outline' | 'ghost';

  /**
   * Shows a destructive hover treatment on top of any variant.
   *
   * @default
   * false
   */
  destructiveHover?: boolean;

  /**
   * Disables the button reactively while it returns `true`.
   * A `<button>` gets the real `disabled` attribute.
   * A link or span gets `aria-disabled` and leaves the tab order.
   */
  disabled?: () => boolean;

  /**
   * Shows a spinner in place of the icon while it returns `true`.
   * The button is disabled and `aria-busy` meanwhile, but keeps its variant colors.
   */
  loading?: () => boolean;

  /**
   * A leading icon before the label.
   */
  icon?: IconName;

  /**
   * Hides the label and leaves the icon in a square button.
   * The label becomes the accessible name and a hover tooltip.
   * A step hides it only while the nearest container is narrower than that step; `true` always hides it.
   */
  iconOnly?: Step | true;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Content straddling the top-right corner, usually a `bubble`.
   */
  bubble?: Child | (() => Child);

  /**
   * Extra class names appended to the button's own.
   */
  class?: string;

  /**
   * The accessible name, for a button whose visible content is only an icon.
   * With `iconOnly`, a `Text` label names the button by itself.
   */
  ariaLabel?: Text;

  /**
   * Click handler; a `submit` button inside a form submits through the form as well.
   */
  onClick?: (event: MouseEvent) => void;
}

css`
  .ohne-button {
    flex-shrink: 0;
    position: relative;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    max-width: 100%;
    min-width: calc(2em + 0.25rem);
    height: calc(2em + 0.25rem);
    border: 1px solid transparent;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.5;
    font-weight: 500;
    white-space: nowrap;
    text-decoration: none;
    user-select: none;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, color;
  }

  .ohne-button-primary {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-button-primary:hover {
    background-color: hsl(var(--ohne-primary) / 0.9);
  }

  .ohne-button-secondary {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-button-secondary:hover {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-accent {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-accent:hover {
    background-color: hsl(var(--ohne-accent) / 0.9);
  }

  .ohne-button-destructive {
    --ohne-ring: var(--ohne-destructive);
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-button-destructive:hover {
    background-color: hsl(var(--ohne-destructive) / 0.9);
  }

  .ohne-button-outline {
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-input));
  }

  .ohne-button-outline:hover {
    background-color: hsl(var(--ohne-accent));
    border: 1px solid hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-ghost {
    background-color: transparent;
  }

  .ohne-button-ghost:hover {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-button-destructive-hover {
    --ohne-ring: var(--ohne-destructive);
  }

  .ohne-button-destructive-hover:hover {
    background-color: hsl(var(--ohne-destructive) / 0.9);
    border-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-button-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    pointer-events: none;
    background-color: hsl(var(--ohne-muted));
    border-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-button-inner {
    display: flex;
    align-items: center;
    gap: 0.375em;
    padding: 0 0.75em;
    padding: 0 round(0.75em, 1px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-button-inner > svg {
    flex-shrink: 0;
    pointer-events: none;
    font-size: calc(1em + 0.25rem);
  }

  .ohne-button-inner > svg:first-child {
    margin-left: -0.25em;
    margin-left: round(-0.25em, 1px);
  }

  .ohne-button-inner > svg:last-child {
    margin-right: -0.25em;
    margin-right: round(-0.25em, 1px);
  }

  .ohne-button-inner > svg:only-child {
    position: absolute;
    inset: 0;
    margin: auto;
  }

  .ohne-button-inner > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-button-loading {
    pointer-events: none;
  }

  .ohne-button-bubble {
    position: absolute;
    z-index: 1;
    top: 0;
    right: 0;
    display: flex;
    transform: translate(50%, -50%);
  }

  ${Object.entries(STEP_WIDTHS)
    .map(
      ([step, width]) => `
        @container (width < ${width}) {
          .ohne-button-icon-only-${step} {
            width: calc(2em + 0.25rem);
          }

          .ohne-button-icon-only-${step} > .ohne-button-inner {
            padding: 0;
          }

          .ohne-button-icon-only-${step} > .ohne-button-inner > svg {
            margin: 0;
          }

          .ohne-button-icon-only-${step} .ohne-button-label {
            display: none;
          }
        }
      `,
    )
    .join('')}

  @media (prefers-reduced-motion: no-preference) {
    .ohne-button-spinner {
      animation: ohne-button-spin 1s linear infinite;
    }
  }

  @keyframes ohne-button-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

/**
 * The button primitive: a variant matrix, an icon-aware inner layout, and an optional corner bubble.
 * The label is `Text`, resolved live, or any `Child`; an icon-only content centers in a guaranteed square.
 * `href` renders an `<a>` the router intercepts.
 * `disabled` and `loading` set the real `disabled` on a `<button>`, and `aria-disabled` on a link or span.
 *
 * @example
 * ```ts
 * button('Save', { type: 'submit', icon: 'device-floppy', loading: () => saving.value })
 * button('Delete', { icon: 'trash', iconOnly: true, variant: 'ghost', destructiveHover: true })
 * ```
 */
export function button(label: Text | Child, options: ButtonOptions = {}): HTMLElement {
  const tag = options.is ?? (options.href ? 'a' : 'button');
  const { disabled, loading, iconOnly, ariaLabel } = options;
  const blocked = (): boolean => disabled?.() === true || loading?.() === true;
  const guarded = !isUndefined(disabled) || !isUndefined(loading);
  const text =
    isString(label) || isPlainObject(label) || (!isUndefined(iconOnly) && isFunction(label))
      ? (label as Text)
      : undefined;
  const leading =
    isUndefined(loading) && isUndefined(options.icon)
      ? null
      : (): Child =>
          loading?.() ? spinnerIcon() : isUndefined(options.icon) ? null : icon(options.icon);
  const labelEl =
    isUndefined(text) || iconOnly === true
      ? null
      : h('span', { class: 'ohne-button-label' }, () => resolveText(text));
  const content =
    iconOnly === true || !isUndefined(text)
      ? labelEl
      : isFunction(label) && !isNull(leading)
        ? h('span', { class: 'ohne-button-label' }, label)
        : (label as Child);
  const name = ariaLabel ?? (isUndefined(iconOnly) ? undefined : text);
  const el = h(
    tag,
    {
      disabled: tag === 'button' && guarded ? blocked : undefined,
      'aria-disabled': tag !== 'button' && guarded ? () => (blocked() ? 'true' : null) : undefined,
      'aria-busy': isUndefined(loading) ? undefined : () => (loading() ? 'true' : null),
      tabindex: tag !== 'button' && guarded ? () => (blocked() ? -1 : null) : undefined,
      target: options.target,
      href: tag === 'a' ? options.href : undefined,
      type: options.type ?? (tag === 'button' ? 'button' : undefined),
      class: () =>
        `ohne-button ohne-raw ohne-button-${options.variant ?? 'primary'}` +
        (options.destructiveHover ? ' ohne-button-destructive-hover' : '') +
        (disabled?.() ? ' ohne-button-disabled' : '') +
        (loading?.() ? ' ohne-button-loading' : '') +
        (isString(iconOnly) ? ` ohne-button-icon-only-${iconOnly}` : '') +
        (options.class ? ` ${options.class}` : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      'aria-label': isUndefined(name) ? undefined : () => resolveText(name),
      onClick: options.onClick,
    },
    h('span', { class: 'ohne-button-inner' }, leading, content),
    isUndefined(options.bubble) ? null : h('span', { class: 'ohne-button-bubble' }, options.bubble),
  );
  if (!isUndefined(iconOnly) && !isUndefined(text)) {
    onCleanup(
      attachTooltip(el, () =>
        iconOnly === true || (labelEl && getComputedStyle(labelEl).display === 'none')
          ? resolveText(text)
          : null,
      ),
    );
  }
  return el;
}

/**
 * The rotating loader that stands in for the leading icon while the button loads.
 */
function spinnerIcon(): SVGSVGElement {
  const svg = icon('loader-2');
  svg.classList.add('ohne-button-spinner');
  return svg;
}
