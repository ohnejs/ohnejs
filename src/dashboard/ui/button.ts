import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
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
   */
  href?: string;

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
   * Interaction is blocked purely via CSS and `tabindex`, so links disable the same way.
   */
  disabled?: () => boolean;

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
   */
  ariaLabel?: string;

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
    top: 50%;
    left: 50%;
    margin: 0;
    transform: translate3d(-50%, -50%, 0);
  }

  .ohne-button-inner > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-button-bubble {
    position: absolute;
    z-index: 1;
    top: 0;
    right: 0;
    display: flex;
    transform: translate(50%, -50%);
  }
`;

/**
 * The button primitive: a variant matrix, an icon-aware inner layout, and an optional corner bubble.
 * An icon-only content centers absolutely in a guaranteed square; edge icons pull inward.
 * `href` renders an `<a>` the router intercepts; `disabled` never sets the attribute, so links
 * and buttons disable identically through CSS `pointer-events` and `tabindex`.
 *
 * @example
 * ```ts
 * button('Save', { type: 'submit' })
 * button(icon('trash'), { variant: 'ghost', destructiveHover: true })
 * ```
 */
export function button(label: Child | (() => Child), options: ButtonOptions = {}): HTMLElement {
  const tag = options.is ?? (options.href ? 'a' : 'button');
  return h(
    tag,
    {
      tabindex: options.disabled ? () => (options.disabled?.() ? -1 : null) : undefined,
      target: options.target,
      href: tag === 'a' ? options.href : undefined,
      type: options.type ?? (tag === 'button' ? 'button' : undefined),
      class: () =>
        `ohne-button ohne-raw ohne-button-${options.variant ?? 'primary'}` +
        (options.destructiveHover ? ' ohne-button-destructive-hover' : '') +
        (options.disabled?.() ? ' ohne-button-disabled' : '') +
        (options.class ? ` ${options.class}` : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      'aria-label': options.ariaLabel,
      onClick: options.onClick,
    },
    h('span', { class: 'ohne-button-inner' }, label),
    options.bubble === undefined
      ? null
      : h('span', { class: 'ohne-button-bubble' }, options.bubble),
  );
}
