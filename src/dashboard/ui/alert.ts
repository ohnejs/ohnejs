import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `alert`.
 */
export interface AlertOptions {
  /**
   * The visual style variant of the alert.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'destructive';

  /**
   * The title of the alert, rendered bold above the content.
   */
  title?: string;

  /**
   * An icon rendered in front of the content, at `1.5em`.
   */
  icon?: Child | (() => Child);

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-alert {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    display: flex;
    gap: 0.5em;
    width: 100%;
    max-width: 100%;
    background-color: hsl(var(--ohne-card));
    border-width: 1px;
    border-radius: var(--ohne-radius);
    padding: 0.75rem;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-alert-destructive {
    --ohne-foreground: var(--ohne-destructive);
    --ohne-accent: var(--ohne-destructive) / 0.15;
    --ohne-accent-foreground: var(--ohne-destructive);
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive));
  }

  .dark .ohne-alert-destructive {
    background-color: hsl(var(--ohne-background));
  }

  .ohne-alert-icon {
    flex-shrink: 0;
    font-size: 1.5em;
  }

  .ohne-alert-main {
    flex: 1;
  }

  .ohne-alert-title {
    margin-bottom: 0.125em;
    font-weight: 600;
  }

  .ohne-alert-content {
    font-size: calc(1em - 0.0625rem);
  }
`;

/**
 * A static callout box with an optional icon and title, announced as `role="alert"`.
 * The destructive variant retheming bakes a `0.15` alpha into `--ohne-accent`.
 * Nested accent surfaces therefore wash to 15% destructive.
 *
 * @example
 * ```ts
 * alert('The record is locked by another editor.', {
 *   variant: 'destructive',
 *   title: 'Locked',
 *   icon: icon('lock'),
 * })
 * ```
 */
export function alert(content: Child | (() => Child), options: AlertOptions = {}): HTMLElement {
  return h(
    'div',
    {
      role: 'alert',
      class: `ohne-alert ohne-alert-${options.variant ?? 'primary'}`,
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    options.icon === undefined ? null : h('div', { class: 'ohne-alert-icon' }, options.icon),
    h(
      'div',
      { class: 'ohne-alert-main' },
      options.title === undefined ? null : h('p', { class: 'ohne-alert-title' }, options.title),
      h('div', { class: 'ohne-alert-content' }, content),
    ),
  );
}
