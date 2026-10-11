import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { proseChild } from './_text-child.ts';
import { button } from './button.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `emptyState`.
 */
export interface EmptyStateOptions {
  /**
   * The faded icon above the text.
   *
   * @default
   * 'inbox'
   */
  icon?: IconName;

  /**
   * A heading above the text.
   */
  title?: Text;

  /**
   * What the reader can do about the emptiness, usually a `button`.
   */
  action?: Child;
}

/**
 * Options for `errorState`.
 */
export interface ErrorStateOptions {
  /**
   * Called by a retry button under the text.
   * Omitted shows no button.
   */
  retry?: () => void;
}

/**
 * Options for `skeleton`.
 */
export interface SkeletonOptions {
  /**
   * How many text lines the placeholder stands in for; the last line is shorter.
   *
   * @default
   * 1
   */
  lines?: number;

  /**
   * A CSS height for one solid block, which replaces the lines.
   */
  height?: string;

  /**
   * The CSS width of the placeholder.
   *
   * @default
   * '100%'
   */
  width?: string;
}

/**
 * Options for `spinner`.
 */
export interface SpinnerOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-state {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    align-items: center;
    padding: 1.5em 0.75em;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    text-align: center;
  }

  .ohne-state > svg {
    font-size: 2.5em;
    opacity: 0.5;
  }

  .ohne-state-title {
    margin: 0;
    color: hsl(var(--ohne-foreground));
    font-weight: 600;
  }

  .ohne-state-text {
    max-width: 32em;
    margin: 0;
    font-size: calc(1em - 0.125rem);
    overflow-wrap: anywhere;
  }

  .ohne-state-action {
    margin-top: 0.25em;
  }

  .ohne-skeleton {
    display: flex;
    flex-direction: column;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-skeleton-bar {
    box-sizing: border-box;
    height: 1.5em;
    height: 1lh;
    padding-block: 0.25em;
    background-color: hsl(var(--ohne-muted));
    background-clip: content-box;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .ohne-skeleton-bar:last-child:not(:first-child) {
    width: 60%;
  }

  .ohne-skeleton-block {
    flex: 1 1 auto;
    height: auto;
    padding-block: 0;
  }

  .ohne-spinner {
    display: inline-flex;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-spinner-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-skeleton-bar {
      background-image: linear-gradient(
        90deg,
        transparent 25%,
        hsl(var(--ohne-muted-foreground) / 0.12) 50%,
        transparent 75%
      );
      background-size: 400% 100%;
      animation: ohne-skeleton 1.5s ease-in-out infinite;
    }

    .ohne-spinner > svg {
      animation: ohne-spinner 1s linear infinite;
    }
  }

  @keyframes ohne-skeleton {
    from {
      background-position: 100% 0;
    }

    to {
      background-position: 0 0;
    }
  }

  @keyframes ohne-spinner {
    to {
      transform: rotate(360deg);
    }
  }
`;

/**
 * A centered, muted note that a list, table, or page has nothing to show yet.
 * A faded icon sits above the optional title and the text; an action may follow.
 *
 * @example
 * ```ts
 * emptyState('No quests yet', { title: 'Quest log', action: button('Accept a quest') })
 * ```
 */
export function emptyState(text: Text, options: EmptyStateOptions = {}): HTMLElement {
  const { title } = options;
  return h(
    'div',
    { class: 'ohne-state' },
    icon(options.icon ?? 'inbox'),
    isUndefined(title) ? null : h('p', { class: 'ohne-state-title' }, () => resolveText(title)),
    h('div', { class: 'ohne-state-text' }, proseChild(text)),
    isUndefined(options.action) ? null : h('div', { class: 'ohne-state-action' }, options.action),
  );
}

/**
 * A centered, muted note that loading failed, announced as `role="alert"`.
 * Omitted text reads "Failed to load"; a `retry` adds an outline retry button.
 *
 * @example
 * ```ts
 * errorState(undefined, { retry: () => resource.reload() })
 * ```
 */
export function errorState(text?: Text, options: ErrorStateOptions = {}): HTMLElement {
  const { retry } = options;
  return h(
    'div',
    { class: 'ohne-state', role: 'alert' },
    icon('cloud-off'),
    h(
      'div',
      { class: 'ohne-state-text' },
      proseChild(text ?? (() => defaultText('dashboard.loadFailed', 'Failed to load'))),
    ),
    isUndefined(retry)
      ? null
      : h(
          'div',
          { class: 'ohne-state-action' },
          button(() => defaultText('dashboard.retry', 'Retry'), {
            variant: 'outline',
            size: -1,
            onClick: () => retry(),
          }),
        ),
  );
}

/**
 * A muted, shimmering placeholder that holds a loading region at its final height.
 * Lines stand in for text, a `height` for a solid block; screen readers skip it.
 *
 * @example
 * ```ts
 * skeleton({ lines: 3 })
 * skeleton({ height: '12rem' })
 * ```
 */
export function skeleton(options: SkeletonOptions = {}): HTMLElement {
  const { height, lines = 1, width } = options;
  const size = [
    isUndefined(width) ? '' : `width: ${width}`,
    isUndefined(height) ? '' : `height: ${height}`,
  ];
  return h(
    'div',
    {
      class: 'ohne-skeleton',
      'aria-hidden': 'true',
      style: size.filter((rule) => rule !== '').join('; ') || undefined,
    },
    isUndefined(height)
      ? Array.from({ length: Math.max(lines, 1) }, () => h('div', { class: 'ohne-skeleton-bar' }))
      : h('div', { class: 'ohne-skeleton-bar ohne-skeleton-block' }),
  );
}

/**
 * A rotating loader icon, announced as `role="status"` with a hidden "Loading" label.
 * The icon holds still for readers who prefer reduced motion.
 *
 * @example
 * ```ts
 * spinner({ size: -1 })
 * ```
 */
export function spinner(options: SpinnerOptions = {}): HTMLElement {
  return h(
    'span',
    {
      class: 'ohne-spinner',
      role: 'status',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    icon('loader-2'),
    h('span', { class: 'ohne-spinner-label' }, () => defaultText('dashboard.loading', 'Loading')),
  );
}
