import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { formatNumber } from '../../runtime/number.ts';
import { defaultText, resolveText, type Text } from '../../runtime/text.ts';
import { skeleton } from '../states.ts';
import { dataFrame } from './_frame.ts';
import { inkStyle } from './_series.ts';
import '../tokens.ts';

/**
 * Options for `funnel`.
 */
export interface FunnelOptions<T> {
  /**
   * The step's name.
   */
  label: (row: T) => Text;

  /**
   * How many reached the step.
   */
  value: (row: T) => number;
}

const PLACEHOLDER_STEPS = 4;

css`
  .ohne-funnel {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin: 0;
    padding: 0;
    font-size: 0.875rem;
    list-style: none;
  }

  .ohne-funnel-head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .ohne-funnel-index {
    display: inline-grid;
    flex-shrink: 0;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .ohne-funnel-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-funnel-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .ohne-funnel-track {
    height: 0.625rem;
    margin: 0.375rem 0 0.25rem 1.75rem;
    overflow: hidden;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-muted));
  }

  .ohne-funnel-fill {
    height: 100%;
    min-width: 0.25rem;
    border-radius: inherit;
    background-color: hsl(var(--ohne-chart-ink));
  }

  .ohne-funnel-fill[hidden] {
    display: none;
  }

  .ohne-funnel-rate:empty {
    display: none;
  }

  .ohne-funnel-rate {
    min-height: 1.125rem;
    margin-left: 1.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * A funnel: one numbered bar per step, in order, on one scale from the largest step.
 * Under each later bar, in words, the share of the step before it and of the first step.
 * A step that outnumbers the one before it shows no share, since the steps then count different things.
 * A first step of `0` or less gives no share of the first.
 * Loading holds the height with a placeholder; no steps show an empty state.
 *
 * @example
 * ```ts
 * funnel(() => recruitment.value, {
 *   label: (step) => step.name,
 *   value: (step) => step.players,
 * })
 * ```
 */
export function funnel<T>(
  data: () => readonly T[] | undefined,
  options: FunnelOptions<T>,
): HTMLElement {
  return h(
    'div',
    { class: 'ohne-funnel-chart' },
    dataFrame(
      data,
      {
        height: `${PLACEHOLDER_STEPS * 3.5}rem`,
        placeholder: () =>
          h(
            'div',
            { class: 'ohne-funnel' },
            Array.from({ length: PLACEHOLDER_STEPS }, () => skeleton({ lines: 2 })),
          ),
      },
      (rows) => steps(rows, options),
    ),
  );
}

/**
 * The steps that have arrived.
 */
function steps<T>(rows: () => readonly T[], options: FunnelOptions<T>): HTMLElement {
  const first = (): number => Math.max(0, options.value(rows()[0]!));
  const peak = (): number => Math.max(1, ...rows().map((row) => options.value(row)));
  const share = (value: number, base: number): string =>
    formatNumber(value / base, { percent: true, decimals: value / base < 0.1 ? 1 : 0 });
  const rate = (index: number): string => {
    if (index === 0) return '';
    const value = options.value(rows()[index]!);
    const before = options.value(rows()[index - 1]!);
    if (before <= 0 || value > before) return '';
    const ofBefore = defaultText('dashboard.ofPrevious', '{share} of previous', {
      share: share(value, before),
    });
    if (index === 1 || first() === 0 || value > first()) return ofBefore;
    const ofFirst = defaultText('dashboard.ofFirst', '{share} of first', {
      share: share(value, first()),
    });
    return `${ofBefore} · ${ofFirst}`;
  };
  return h(
    'ol',
    { class: 'ohne-funnel' },
    each(
      rows,
      (_, index) => index,
      (row, index) =>
        h(
          'li',
          null,
          h(
            'div',
            { class: 'ohne-funnel-head' },
            h('span', { class: 'ohne-funnel-index', 'aria-hidden': 'true' }, () => index() + 1),
            h('span', { class: 'ohne-funnel-label' }, () => resolveText(options.label(row()))),
            h('strong', { class: 'ohne-funnel-value' }, () => formatNumber(options.value(row()))),
          ),
          h(
            'div',
            { class: 'ohne-funnel-track', 'aria-hidden': 'true' },
            h('div', {
              class: 'ohne-funnel-fill',
              hidden: () => options.value(row()) <= 0,
              style: () => `${inkStyle(1)}; width: ${(options.value(row()) / peak()) * 100}%`,
            }),
          ),
          h('div', { class: 'ohne-funnel-rate' }, () => rate(index()) || null),
        ),
    ),
  );
}
