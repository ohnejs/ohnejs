import type { Text } from '../runtime/text.ts';
import type { Tone } from './tone.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText } from '../runtime/text.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * Options for `levelMeter`.
 */
export interface LevelMeterOptions {
  /**
   * How many bars the meter shows, rising in height from left to right.
   *
   * @default
   * 5
   */
  bars?: number;

  /**
   * The meaning the lit bars' color carries.
   *
   * @default
   * 'primary'
   */
  tone?: Tone;

  /**
   * What the meter measures, such as "Microphone", for screen readers.
   */
  label?: Text;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-level-meter {
    display: inline-flex;
    flex-shrink: 0;
    align-items: flex-end;
    gap: 0.125em;
    height: 1em;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-level-meter-bar {
    width: 0.1875em;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-muted));
  }

  .ohne-level-meter-lit {
    background-color: hsl(var(--ohne-tone-ink));
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-level-meter-bar {
      transition: background-color 120ms ease-out;
    }
  }
`;

/**
 * A row of small bars that light up with a live level, such as a microphone or a caller's voice.
 * `level()` reads `0` to `1` and lights that share of the bars, rounded; values past either end clamp.
 * It is a `role="meter"` reading the level in percent, so assistive technology hears the number.
 *
 * @example
 * ```ts
 * levelMeter(() => levels.value.remote, { label: 'Caller', tone: 'success' })
 * ```
 */
export function levelMeter(level: () => number, options: LevelMeterOptions = {}): HTMLElement {
  const { bars = 5, tone = 'primary', label, size } = options;
  const lit = (): number => Math.round(clamp(level(), 0, 1) * bars);
  return h(
    'div',
    {
      class: `ohne-level-meter ohne-tone-${tone}`,
      style: isUndefined(size) ? undefined : `--ohne-size: ${size}`,
      role: 'meter',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': () => Math.round(clamp(level(), 0, 1) * 100),
      'aria-label': isUndefined(label) ? undefined : () => resolveText(label),
    },
    Array.from({ length: bars }, (_, i) =>
      h('span', {
        class: () =>
          lit() > i ? 'ohne-level-meter-bar ohne-level-meter-lit' : 'ohne-level-meter-bar',
        style: `height: ${bars === 1 ? 100 : Math.round(40 + (60 * i) / (bars - 1))}%`,
        'aria-hidden': 'true',
      }),
    ),
  );
}
