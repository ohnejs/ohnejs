import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `bubble`.
 */
export interface BubbleOptions {
  /**
   * The visual style variant of the bubble.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive';

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-bubble {
    flex-shrink: 0;
    display: inline-block;
    border-radius: 999rem;
    min-width: 1em;
    min-width: round(1em, 1px);
    min-height: 1em;
    min-height: round(1em, 1px);
    padding: 0.125em 0.5em;
    padding: round(0.125em, 1px) round(0.5em, 1px);
    border: 1px solid hsl(var(--ohne-background));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem - 0.1875rem);
    font-weight: 600;
  }

  .ohne-bubble:empty {
    padding: 0;
  }

  .ohne-bubble-primary {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-bubble-secondary {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-bubble-accent {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-bubble-destructive {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }
`;

/**
 * A tiny count or notification pill, usually docked to a corner of another control.
 * Its border paints a fake cutout in `--ohne-background`, so token-retheming parents blend it in.
 * Pass no content to render a plain dot: the `:empty` state drops the padding, and a reactive
 * getter child would defeat it, so keep dot bubbles static.
 *
 * @example
 * ```ts
 * bubble('3', { variant: 'destructive' })
 * ```
 */
export function bubble(content?: Child | (() => Child), options: BubbleOptions = {}): HTMLElement {
  return h(
    'span',
    {
      class: `ohne-bubble ohne-bubble-${options.variant ?? 'primary'}`,
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    content,
  );
}
