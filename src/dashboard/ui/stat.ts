import type { Change } from '../../utils/number/change-of.ts';
import type { IconName } from './icon.ts';
import type { Tone } from './tone.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { changeOf } from '../../utils/number/change-of.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { keyed } from '../render/keyed.ts';
import { formatNumber } from '../runtime/number.ts';
import { resourceState } from '../runtime/resource.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { helpIcon } from './_help-icon.ts';
import { sparkline } from './charts/sparkline.ts';
import { icon } from './icon.ts';
import { skeleton } from './states.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * A stat's figure with what it compares against.
 */
export interface StatValue {
  /**
   * The figure the stat shows.
   */
  value: number;

  /**
   * The same figure over the previous period, for the change beside it.
   */
  previous?: number;

  /**
   * The figure over time, oldest first, for the sparkline under it.
   */
  trend?: readonly number[];
}

/**
 * Options for `stat`.
 */
export interface StatOptions {
  /**
   * What the figure is, in sentence case.
   */
  label: Text;

  /**
   * Formats the figure and the previous one.
   * Omitted writes the number in the dashboard language, compact from ten thousand.
   */
  format?: (value: number) => string;

  /**
   * Marks a figure where lower is better, like a refund rate, so a drop reads as good news.
   *
   * @default
   * false
   */
  invert?: boolean;

  /**
   * One line on what the figure means, behind an info icon by the label.
   */
  help?: Text;

  /**
   * Makes the whole tile a link to the page behind the figure.
   */
  href?: string;
}

/**
 * Options for `delta`.
 */
export interface DeltaOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

const ARROWS: Record<Change['direction'], IconName> = {
  up: 'arrow-up-right',
  down: 'arrow-down-right',
  flat: 'minus',
};

const TONES: Record<Change['tone'], Tone> = {
  good: 'success',
  bad: 'destructive',
  neutral: 'neutral',
};

const COMPACT_FROM = 10_000;
const SMALL_RATIO = 0.1;

css`
  .ohne-stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.75rem 0.75rem 0;
    overflow: hidden;
    border-width: 1px;
    border-radius: var(--ohne-radius);
    background-color: hsl(var(--ohne-card));
    color: hsl(var(--ohne-card-foreground));
    font-size: 0.875rem;
    outline: none;
  }

  .ohne-stat:not(:has(.ohne-sparkline)) {
    padding-bottom: 0.75rem;
  }

  a.ohne-stat {
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  @media (hover: hover) {
    a.ohne-stat:hover {
      border-color: hsl(var(--ohne-foreground) / 0.24);
    }
  }

  a.ohne-stat:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-stat-label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.8125rem;
  }

  .ohne-stat-value {
    min-height: 2rem;
    font-size: 1.625rem;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  .ohne-stat-missing {
    display: inline-flex;
    gap: 0.375rem;
    align-items: center;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 2rem;
  }

  .ohne-stat-change {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.375rem;
    align-items: center;
    min-height: 1.375rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .ohne-stat-change:empty {
    display: none;
  }

  .ohne-stat > .ohne-sparkline {
    margin: 0.25rem -0.75rem 0;
  }

  .ohne-delta {
    display: inline-flex;
    flex-shrink: 0;
    gap: 0.125em;
    align-items: center;
    padding: 0.0625em 0.375em 0.0625em 0.25em;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-tone-soft));
    color: hsl(var(--ohne-tone-ink));
    font-size: calc(0.75rem + var(--ohne-size) * 0.125rem);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }

  .ohne-delta[hidden] {
    display: none;
  }
`;

/**
 * A stat tile: the label, the figure, its change against the previous period, and a sparkline.
 * The figure keeps proportional digits and turns compact from ten thousand unless `format` says otherwise.
 * While the value loads a placeholder holds its line; a failed or forbidden `Resource` says so in its place.
 * The change is an arrow, a sign and a tint, never the tint alone.
 *
 * @example
 * ```ts
 * stat(() => guild.value?.gold, {
 *   label: 'Gold in the guild bank',
 *   format: (gold) => `${formatNumber(gold, { compact: true })}g`,
 *   help: 'Counted at the last bank snapshot',
 * })
 * ```
 */
export function stat(
  value: () => StatValue | number | undefined,
  options: StatOptions,
): HTMLElement {
  const { help, href, label } = options;
  const format = options.format ?? defaultFormat;
  const figure = (): StatValue | undefined => {
    const current = value();
    return isNumber(current) ? { value: current } : current;
  };
  const phase = (): string => {
    if (!isUndefined(value())) return 'ready';
    return resourceState(value) ?? 'loading';
  };
  return h(
    isUndefined(href) ? 'div' : 'a',
    { class: isUndefined(href) ? 'ohne-stat' : 'ohne-stat ohne-raw', href },
    h(
      'div',
      { class: 'ohne-stat-label' },
      h('span', null, () => resolveText(label)),
      isUndefined(help) ? null : helpIcon(help),
    ),
    h(
      'div',
      { class: 'ohne-stat-value', 'aria-busy': () => (phase() === 'loading' ? 'true' : undefined) },
      keyed(phase, () => {
        const current = phase();
        if (current === 'ready') return () => format(figure()?.value ?? 0);
        if (current === 'loading') return skeleton({ height: '2rem', width: '6rem' });
        const forbidden = current === 'forbidden';
        return h(
          'span',
          { class: 'ohne-stat-missing' },
          icon(forbidden ? 'lock' : 'cloud-off'),
          h('span', null, () =>
            forbidden
              ? defaultText('dashboard.forbidden', 'You do not have access to this')
              : defaultText('dashboard.loadFailed', 'Failed to load'),
          ),
        );
      }),
    ),
    h('div', { class: 'ohne-stat-change' }, () => {
      const current = figure();
      if (isUndefined(current?.previous)) return null;
      const { previous } = current;
      return [
        delta(() => changeOf(current.value, previous, options.invert === true)),
        h('span', null, () =>
          defaultText('dashboard.versus', 'vs {value}', { value: format(previous) }),
        ),
      ];
    }),
    () => {
      const trend = figure()?.trend;
      return isUndefined(trend) ? null : sparkline(() => trend);
    },
  );
}

/**
 * A change as a small pill: an arrow, the signed percentage or points, and a tint for good or bad news.
 * The arrow and the sign carry the meaning too, so the tint is never the only signal.
 * Growth from nothing reads "New"; `undefined`, or any other change from zero, hide the pill.
 *
 * @example
 * ```ts
 * delta(() => changeOf(1240, 1000))      // -> ↗ +24%, tinted as good news
 * delta(() => changeOf(0.12, 0.1, true)) // -> ↗ +20%, tinted as bad news
 * delta(() => changeOfRate(0.12, 0.09))  // -> ↗ +3 pts
 * ```
 */
export function delta(change: () => Change | undefined, options: DeltaOptions = {}): HTMLElement {
  const shown = (): Change | undefined => {
    const current = change();
    return isUndefined(current) || (isNull(current.ratio) && current.direction !== 'up')
      ? undefined
      : current;
  };
  return h(
    'span',
    {
      class: () => `ohne-delta ohne-tone-${TONES[shown()?.tone ?? 'neutral']}`,
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      hidden: () => isUndefined(shown()),
    },
    () => {
      const current = shown();
      if (isUndefined(current)) return null;
      const arrow = icon(ARROWS[current.direction]);
      arrow.setAttribute('aria-hidden', 'true');
      return [arrow, h('span', null, () => changeText(current))];
    },
  );
}

/**
 * A figure in the dashboard language, compact from `COMPACT_FROM`.
 */
function defaultFormat(value: number): string {
  return formatNumber(value, { compact: Math.abs(value) >= COMPACT_FROM });
}

/**
 * A change as signed text: `+23%`, `-4.2%`, `0%`, `+3 pts`, or "New" for growth from nothing.
 */
function changeText(change: Change): string {
  if (isNull(change.ratio)) return defaultText('dashboard.new', 'New');
  const ratio = change.direction === 'flat' ? 0 : change.ratio;
  if (change.points === true) {
    const points = formatNumber(Math.round(ratio * 100), { signed: true });
    return defaultText('dashboard.points', '{points} pts', { points });
  }
  const small = Math.abs(ratio) < SMALL_RATIO && ratio !== 0;
  return formatNumber(ratio, { percent: true, signed: true, decimals: small ? 1 : 0 });
}
