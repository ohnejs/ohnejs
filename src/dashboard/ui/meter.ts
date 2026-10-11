import type { Text } from '../runtime/text.ts';
import type { Tone } from './tone.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { keyed } from '../render/keyed.ts';
import { resolveText } from '../runtime/text.ts';
import { skeleton } from './states.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * Options for `meter`.
 */
export interface MeterOptions {
  /**
   * The value of a full bar.
   *
   * @default
   * 100
   */
  max?: number;

  /**
   * The meaning the fill's color carries.
   *
   * @default
   * 'primary'
   */
  tone?: Tone;

  /**
   * What the bar measures, shown above it with the share in percent.
   * It names the meter for screen readers too.
   */
  label?: Text;
}

css`
  .ohne-meter {
    display: flex;
    flex-direction: column;
    gap: 0.375em;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-meter-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5em;
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-meter-share {
    color: hsl(var(--ohne-muted-foreground));
    font-variant-numeric: tabular-nums;
  }

  .ohne-meter-track {
    height: 0.5em;
    overflow: hidden;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-muted));
  }

  .ohne-meter-fill {
    height: 100%;
    border-radius: inherit;
    background-color: hsl(var(--ohne-tone-ink));
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-meter-fill {
      transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }
  }
`;

/**
 * A horizontal bar showing how full something is: a quota, a progress, a share.
 * The value clamps to `0` through `max`; `undefined` shows a placeholder bar while it loads.
 * It is a `role="meter"` with its value range, so assistive technology reads the number.
 *
 * @example
 * ```ts
 * meter(() => storage.value?.used, { max: 500, label: 'Guild bank slots', tone: 'warning' })
 * ```
 */
export function meter(value: () => number | undefined, options: MeterOptions = {}): HTMLElement {
  const { label, max = 100, tone = 'primary' } = options;
  const share = (): number | undefined => {
    const current = value();
    return isUndefined(current) ? undefined : clamp(current / max, 0, 1) * 100;
  };
  return h(
    'div',
    {
      class: `ohne-meter ohne-tone-${tone}`,
      role: 'meter',
      'aria-valuemin': 0,
      'aria-valuemax': max,
      'aria-valuenow': () => {
        const current = value();
        return isUndefined(current) ? undefined : clamp(current, 0, max);
      },
      'aria-busy': () => (isUndefined(value()) ? 'true' : undefined),
      'aria-label': isUndefined(label) ? undefined : () => resolveText(label),
    },
    isUndefined(label)
      ? null
      : h(
          'div',
          { class: 'ohne-meter-head', 'aria-hidden': 'true' },
          h('span', null, () => resolveText(label)),
          h('span', { class: 'ohne-meter-share' }, () => {
            const current = share();
            return isUndefined(current) ? '' : `${Math.round(current)}%`;
          }),
        ),
    keyed(
      () => isUndefined(value()),
      () =>
        isUndefined(value())
          ? skeleton({ height: '0.5em' })
          : h(
              'div',
              { class: 'ohne-meter-track' },
              h('div', { class: 'ohne-meter-fill', style: () => `width: ${share() ?? 0}%` }),
            ),
    ),
  );
}
