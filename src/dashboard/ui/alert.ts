import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { proseChild } from './_text-child.ts';
import { icon } from './icon.ts';
import { STATUS_TONES, type Tone } from './tone.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * Options for `alert`.
 */
export interface AlertOptions {
  /**
   * The meaning the alert carries.
   * `primary` is the plain card; a status tone rings and inks the box in its color.
   * `destructive` and `warning` announce as `role="alert"`, every other tone is a quiet `note`.
   *
   * @default
   * 'primary'
   */
  tone?: Tone;

  /**
   * The title, rendered bold above the content.
   */
  title?: Text;

  /**
   * An icon in front of the content, at `1.5em`.
   */
  icon?: IconName;

  /**
   * Controls under the content, usually buttons.
   */
  actions?: Child;

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

  .ohne-alert-status {
    --ohne-foreground: var(--ohne-tone);
    --ohne-accent: var(--ohne-tone) / 0.15;
    --ohne-accent-foreground: var(--ohne-tone);
    --ohne-ring: var(--ohne-tone);
    border-color: hsl(var(--ohne-tone));
    color: hsl(var(--ohne-tone));
  }

  .dark .ohne-alert-status {
    background-color: hsl(var(--ohne-background));
  }

  .ohne-alert-surface {
    --ohne-background: var(--ohne-tone);
    --ohne-foreground: var(--ohne-tone-foreground);
    background-color: hsl(var(--ohne-tone));
    border-color: transparent;
    color: hsl(var(--ohne-tone-foreground));
  }

  .ohne-alert-surface > .ohne-alert-main {
    --ohne-accent: var(--ohne-tone-ink) / 0.15;
    --ohne-accent-foreground: var(--ohne-tone-ink);
    --ohne-input: var(--ohne-tone-ink) / 0.2;
  }

  .ohne-alert-icon {
    flex-shrink: 0;
    font-size: 1.5em;
  }

  .ohne-alert-main {
    flex: 1;
    min-width: 0;
  }

  .ohne-alert-title {
    margin-bottom: 0.125em;
    font-weight: 600;
  }

  .ohne-alert-content {
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    margin-top: 0.75em;
  }
`;

/**
 * A static callout box with an optional icon, title, and actions.
 * Any tone but `primary` rethemes `--ohne-accent` to a `0.15` wash of its color.
 * Nested code, ghost and outline buttons therefore take the alert's own color.
 *
 * @example
 * ```ts
 * alert('The record is locked by another editor.', {
 *   tone: 'destructive',
 *   title: 'Locked',
 *   icon: 'lock',
 *   actions: button('Request access', { variant: 'outline', size: -1 }),
 * })
 * ```
 */
export function alert(content: Text | Child, options: AlertOptions = {}): HTMLElement {
  const { actions, size, title, tone = 'primary' } = options;
  const look = STATUS_TONES.has(tone) ? 'status' : tone === 'primary' ? 'plain' : 'surface';
  return h(
    'div',
    {
      role: tone === 'destructive' || tone === 'warning' ? 'alert' : 'note',
      class: `ohne-alert ohne-alert-${look} ohne-tone-${tone}`,
      style: isUndefined(size) ? undefined : `--ohne-size: ${size}`,
    },
    isUndefined(options.icon) ? null : h('div', { class: 'ohne-alert-icon' }, icon(options.icon)),
    h(
      'div',
      { class: 'ohne-alert-main' },
      isUndefined(title) ? null : h('p', { class: 'ohne-alert-title' }, () => resolveText(title)),
      h('div', { class: 'ohne-alert-content' }, proseChild(content)),
      isUndefined(actions) ? null : h('div', { class: 'ohne-alert-actions' }, actions),
    ),
  );
}
