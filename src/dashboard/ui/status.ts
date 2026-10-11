import type { MaybeGetter } from '../../utils/reactive/to-value.ts';
import type { Text } from '../runtime/text.ts';
import type { IconName } from './icon.ts';
import type { Tone } from './tone.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { defaultText, resolveText } from '../runtime/text.ts';
import { badge } from './badge.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * How `statusBadge` shows one state.
 */
export interface StatusLook {
  /**
   * The meaning the state's color carries.
   */
  tone: Tone;

  /**
   * The state in words.
   */
  label: Text;

  /**
   * An icon leading the label.
   * Omitted leads with a dot instead.
   */
  icon?: IconName;
}

/**
 * The states `statusDot` knows: running, stopped, and waiting.
 */
export type DotState = 'on' | 'off' | 'idle';

/**
 * Options for `statusDot`.
 */
export interface StatusDotOptions {
  /**
   * Text shown beside the dot, naming what the state belongs to.
   * The dot itself is named by its state for screen readers either way.
   */
  label?: Text;
}

const DOT_TONES: Record<DotState, Tone> = { on: 'success', off: 'neutral', idle: 'warning' };

const DOT_LABELS: Record<DotState, [key: string, english: string]> = {
  on: ['dashboard.status.on', 'On'],
  off: ['dashboard.status.off', 'Off'],
  idle: ['dashboard.status.idle', 'Idle'],
};

css`
  .ohne-status-badge {
    display: contents;
  }

  .ohne-status-dot {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-status-dot-mark {
    position: relative;
    flex-shrink: 0;
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background-color: hsl(var(--ohne-tone-ink));
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-status-dot.ohne-tone-success .ohne-status-dot-mark::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background-color: inherit;
      animation: ohne-status-dot 2s cubic-bezier(0, 0, 0.2, 1) infinite;
    }
  }

  @keyframes ohne-status-dot {
    75%,
    100% {
      opacity: 0;
      transform: scale(2.5);
    }
  }
`;

/**
 * A soft badge for a state out of a fixed set, looked up in `map` and following the state live.
 * Each state brings its tone, its label, and an icon or a dot, so color never carries it alone.
 *
 * @example
 * ```ts
 * const DEPLOY = {
 *   queued: { tone: 'neutral', label: 'Queued' },
 *   live: { tone: 'success', label: 'Live', icon: 'circle-check' },
 *   failed: { tone: 'destructive', label: 'Failed', icon: 'alert-triangle' },
 * } as const
 *
 * statusBadge(() => deploy.value.state, DEPLOY)
 * ```
 */
export function statusBadge<S extends string>(
  state: MaybeGetter<S>,
  map: Readonly<Record<S, StatusLook>>,
): HTMLElement {
  return h('span', { class: 'ohne-status-badge' }, () => {
    const look = map[toValue(state)];
    return badge(look.label, {
      tone: look.tone,
      variant: 'soft',
      icon: look.icon,
      dot: isUndefined(look.icon),
    });
  });
}

/**
 * A small round light for a running, stopped, or waiting thing, following the state live.
 * `on` glows in the success tone and pulses, `idle` waits in the warning tone, `off` sits muted.
 * The pulse holds still for readers who prefer reduced motion.
 *
 * @example
 * ```ts
 * statusDot(() => (worker.value.busy ? 'on' : 'idle'), { label: 'Queue worker' })
 * ```
 */
export function statusDot(
  state: MaybeGetter<DotState>,
  options: StatusDotOptions = {},
): HTMLElement {
  const { label } = options;
  return h(
    'span',
    {
      class: () => `ohne-status-dot ohne-tone-${DOT_TONES[toValue(state)]}`,
    },
    h('span', {
      class: 'ohne-status-dot-mark',
      role: 'img',
      'aria-label': () => defaultText(...DOT_LABELS[toValue(state)]),
    }),
    isUndefined(label) ? null : h('span', null, () => resolveText(label)),
  );
}
