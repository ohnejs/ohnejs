import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';
import type { IconName } from './icon.ts';
import type { Tone } from './tone.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { textChild } from './_text-child.ts';
import { icon } from './icon.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * Options for `badge`.
 */
export interface BadgeOptions {
  /**
   * The meaning the badge's color carries.
   *
   * @default
   * 'primary'
   */
  tone?: Tone;

  /**
   * How strongly the tone paints: a filled pill, a tinted pill, or an outlined one.
   *
   * @default
   * 'solid'
   */
  variant?: 'solid' | 'soft' | 'outline';

  /**
   * Leads the label with a small dot in the label's color.
   *
   * @default
   * false
   */
  dot?: boolean;

  /**
   * An icon leading the label.
   */
  icon?: IconName;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3125em;
    max-width: 100%;
    padding: 0.140625rem 0.5rem;
    overflow: hidden;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem - 0.0625rem);
    font-weight: 500;
    white-space: nowrap;
    user-select: none;
  }

  .ohne-badge-solid {
    background-color: hsl(var(--ohne-tone));
    color: hsl(var(--ohne-tone-foreground));
  }

  .ohne-badge-soft {
    background-color: hsl(var(--ohne-tone-soft));
    color: hsl(var(--ohne-tone-ink));
  }

  /* An inset ring instead of a border keeps the outline pill as tall as the others. */
  .ohne-badge-outline {
    box-shadow: inset 0 0 0 1px hsl(var(--ohne-tone-line));
    color: hsl(var(--ohne-tone-ink));
  }

  .ohne-badge > svg {
    font-size: calc(1em + 0.125rem);
    margin-left: -0.125em;
  }

  .ohne-badge-dot {
    flex-shrink: 0;
    width: 0.4375em;
    height: 0.4375em;
    border-radius: 50%;
    background-color: currentColor;
  }

  .ohne-badge-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

/**
 * An inline pill label colored by meaning.
 * A `solid` badge fills with its tone, a `soft` one tints, and an `outline` one rings.
 * A long label truncates with an ellipsis at the badge's maximum width.
 *
 * @example
 * ```ts
 * badge('Draft', { tone: 'neutral' })
 * badge('Deployed', { tone: 'success', variant: 'soft', icon: 'circle-check' })
 * ```
 */
export function badge(content: Text | Child, options: BadgeOptions = {}): HTMLElement {
  const { tone = 'primary', variant = 'solid', size } = options;
  return h(
    'span',
    {
      class: `ohne-badge ohne-badge-${variant} ohne-tone-${tone}`,
      style: isUndefined(size) ? undefined : `--ohne-size: ${size}`,
    },
    options.dot ? h('span', { class: 'ohne-badge-dot', 'aria-hidden': 'true' }) : null,
    isUndefined(options.icon) ? null : icon(options.icon),
    h('span', { class: 'ohne-badge-label' }, textChild(content)),
  );
}
