import type { Child } from '../../render/insert.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { svg } from '../../render/svg.ts';
import { formatNumber } from '../../runtime/number.ts';
import { defaultText } from '../../runtime/text.ts';
import { skeleton } from '../states.ts';
import { dataFrame, dataTable } from './_frame.ts';
import { keyStep } from './_keys.ts';
import { inkStyle, otherName, SLOTS } from './_series.ts';
import { chartKey, chartTooltip } from './_tooltip.ts';
import '../tokens.ts';

/**
 * Options for `donutChart`.
 */
export interface DonutChartOptions<T> {
  /**
   * The row's slice name, in the legend and the tooltip.
   */
  label: (row: T) => string;

  /**
   * The row's share of the whole; a value of zero or less draws no slice.
   */
  value: (row: T) => number;

  /**
   * The figure in the hole.
   * Omitted shows the total.
   */
  center?: Child;

  /**
   * Formats a value for the legend, the tooltip, the total and the screen reader table.
   * Omitted writes the number in the dashboard language.
   */
  format?: (value: number) => string;
}

/**
 * One drawn slice: its name, its value, and its palette slot, `null` for "Other".
 */
interface Slice {
  name: string;
  value: number;
  slot: number | null;
}

const SIZE = 200;
const OUTER = 100;
const INNER = 72;
const GAP = 2;

css`
  .ohne-donut {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    align-items: center;
  }

  .ohne-donut-ring {
    position: relative;
    flex-shrink: 0;
    width: min(100%, 12.5rem);
    margin-inline: auto;
  }

  .ohne-donut-ring > svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .ohne-donut-slice {
    fill: hsl(var(--ohne-chart-ink));
  }

  .ohne-donut-dim .ohne-donut-slice:not(.ohne-donut-active) {
    opacity: 0.35;
  }

  .ohne-donut-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 18%;
    text-align: center;
    pointer-events: none;
  }

  .ohne-donut-total {
    font-size: 1.375rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .ohne-donut-caption {
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .ohne-donut-legend {
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    font-size: 0.8125rem;
    list-style: none;
  }

  .ohne-donut-legend > li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .ohne-donut-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-donut-value {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .ohne-donut-share {
    min-width: 2.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-donut-slice {
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
  }
`;

/**
 * A donut of each row's share of the whole, with the total in the hole and a legend of values beside it.
 * Each slice takes the palette slot of its place; past eight rows the smallest fold into one "Other".
 * A 2px surface gap parts the slices, and the slice under the pointer or the keyboard lifts.
 * Reach for it for a part-to-whole glance over a few slices; to compare close values, use `barList`.
 * Loading holds the height with a placeholder; no rows show an empty state.
 *
 * @example
 * ```ts
 * donutChart(() => classes.value, {
 *   label: (row) => row.class,
 *   value: (row) => row.players,
 * })
 * ```
 */
export function donutChart<T>(
  data: () => readonly T[] | undefined,
  options: DonutChartOptions<T>,
): HTMLElement {
  return h(
    'div',
    { class: 'ohne-donut-chart' },
    dataFrame(
      data,
      {
        height: '12.5rem',
        placeholder: () =>
          h(
            'div',
            { class: 'ohne-donut' },
            h('div', { class: 'ohne-donut-ring' }, skeleton({ height: '12.5rem' })),
            h('div', { class: 'ohne-donut-legend' }, skeleton({ lines: 4 })),
          ),
      },
      (rows) => plot(rows, options),
    ),
  );
}

/**
 * The drawn donut for rows that have arrived.
 */
function plot<T>(rows: () => readonly T[], options: DonutChartOptions<T>): Child {
  const format = options.format ?? ((value: number) => formatNumber(value));
  const slices = computed(() => fold(rows(), options));
  const total = computed(() => slices.value.reduce((sum, slice) => sum + slice.value, 0));
  const share = (value: number): string =>
    formatNumber(total.value === 0 ? 0 : value / total.value, { percent: true });
  const active = ref<number | null>(null);
  const tooltip = chartTooltip();
  const ring = svg('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: 'ohne-donut-svg',
    'aria-hidden': 'true',
  });
  const stage = h(
    'div',
    { class: () => (isNull(active.value) ? 'ohne-donut-ring' : 'ohne-donut-ring ohne-donut-dim') },
    ring,
    h(
      'div',
      { class: 'ohne-donut-center' },
      options.center ?? [
        h('span', { class: 'ohne-donut-total' }, () => format(total.value)),
        h('span', { class: 'ohne-donut-caption' }, () => defaultText('dashboard.total', 'Total')),
      ],
    ),
    tooltip.root,
  );

  const sliceAt = (event: PointerEvent): number | null => {
    const index = (event.target as Element).getAttribute('data-index');
    return isNull(index) ? null : Number(index);
  };

  const root = h(
    'div',
    {
      class: 'ohne-chart ohne-donut',
      tabindex: 0,
      role: 'group',
      'aria-label': () => slices.value.map((slice) => slice.name).join(', '),
      onPointermove: (event: PointerEvent) => (active.value = sliceAt(event)),
      onPointerdown: (event: PointerEvent) => (active.value = sliceAt(event)),
      onPointerleave: (event: PointerEvent) => {
        if (event.pointerType !== 'touch') active.value = null;
      },
      onFocus: () => (active.value ??= 0),
      onBlur: () => (active.value = null),
      onKeydown: (event: KeyboardEvent) => {
        const next = keyStep(event.key, active.value, slices.value.length);
        if (isUndefined(next)) return;
        event.preventDefault();
        active.value = next;
      },
    },
    stage,
    h('ul', { class: 'ohne-donut-legend', 'aria-hidden': 'true' }, () =>
      slices.value.map((slice) =>
        h(
          'li',
          null,
          chartKey('bar', slice.slot),
          h('span', { class: 'ohne-donut-name' }, slice.name),
          h('span', { class: 'ohne-donut-value' }, format(slice.value)),
          h('span', { class: 'ohne-donut-share' }, share(slice.value)),
        ),
      ),
    ),
    dataTable({
      head: () => [
        '',
        defaultText('dashboard.value', 'Value'),
        defaultText('dashboard.share', 'Share'),
      ],
      rows: () =>
        slices.value.map((slice) => [slice.name, format(slice.value), share(slice.value)]),
    }),
  );

  effect(() => {
    const current = slices.value;
    const sum = total.value;
    ring.replaceChildren();
    if (sum <= 0) return;
    const whole = current.filter((slice) => slice.value > 0).length === 1;
    let angle = -Math.PI / 2;
    for (const [index, slice] of current.entries()) {
      const sweep = (slice.value / sum) * Math.PI * 2;
      if (sweep > 0) {
        ring.append(
          svg('path', {
            class: 'ohne-donut-slice',
            style: inkStyle(slice.slot),
            d: arc(angle, angle + sweep, whole),
            'data-index': index,
          }),
        );
      }
      angle += sweep;
    }
  });

  effect(() => {
    const index = active.value;
    const current = slices.value;
    const sum = total.value;
    for (const path of ring.children) {
      const lifted = path.getAttribute('data-index') === String(index);
      path.setAttribute(
        'class',
        lifted ? 'ohne-donut-slice ohne-donut-active' : 'ohne-donut-slice',
      );
    }
    const slice = isNull(index) ? undefined : current[index];
    if (isNull(index) || isUndefined(slice) || sum <= 0) {
      tooltip.hide();
      return;
    }
    const before = current.slice(0, index).reduce((total, one) => total + one.value, 0);
    const middle = -Math.PI / 2 + ((before + slice.value / 2) / sum) * Math.PI * 2;
    const scale = (ring.getBoundingClientRect().width || SIZE) / SIZE;
    const radius = ((OUTER + INNER) / 2) * scale;
    const centre = (SIZE / 2) * scale;
    tooltip.show(
      centre + Math.cos(middle) * radius,
      slice.name,
      [{ value: format(slice.value), name: share(slice.value), mark: 'bar', slot: slice.slot }],
      centre + Math.sin(middle) * radius,
    );
  });

  return root;
}

/**
 * The rows as slices in their order, past `SLOTS` rows keeping the largest and folding the rest into "Other".
 */
function fold<T>(rows: readonly T[], options: DonutChartOptions<T>): Slice[] {
  const all = rows.map((row) => ({
    name: options.label(row),
    value: Math.max(0, options.value(row)),
  }));
  if (all.length <= SLOTS) return all.map((slice, index) => ({ ...slice, slot: index + 1 }));
  const kept = new Set(
    all
      .map((slice, index) => ({ value: slice.value, index }))
      .sort((a, b) => b.value - a.value)
      .slice(0, SLOTS - 1)
      .map((slice) => slice.index),
  );
  const shown = all.filter((_, index) => kept.has(index));
  const rest = all.reduce((sum, slice, index) => (kept.has(index) ? sum : sum + slice.value), 0);
  return [
    ...shown.map((slice, index) => ({ ...slice, slot: index + 1 })),
    { name: otherName(), value: rest, slot: null },
  ];
}

/**
 * The ring sector from angle `a0` to `a1`, inset by half the surface gap on each side.
 * A lone slice is the whole ring, with no gap.
 */
function arc(a0: number, a1: number, whole: boolean): string {
  const c = SIZE / 2;
  const point = (radius: number, angle: number): string =>
    `${c + Math.cos(angle) * radius},${c + Math.sin(angle) * radius}`;
  if (whole) {
    return (
      `M${point(OUTER, 0)}A${OUTER},${OUTER} 0 1 1 ${point(OUTER, Math.PI)}` +
      `A${OUTER},${OUTER} 0 1 1 ${point(OUTER, 0)}Z` +
      `M${point(INNER, 0)}A${INNER},${INNER} 0 1 0 ${point(INNER, Math.PI)}` +
      `A${INNER},${INNER} 0 1 0 ${point(INNER, 0)}Z`
    );
  }
  const outer = Math.min(GAP / 2 / OUTER, (a1 - a0) / 2);
  const inner = Math.min(GAP / 2 / INNER, (a1 - a0) / 2);
  const large = a1 - a0 - outer * 2 > Math.PI ? 1 : 0;
  return (
    `M${point(OUTER, a0 + outer)}A${OUTER},${OUTER} 0 ${large} 1 ${point(OUTER, a1 - outer)}` +
    `L${point(INNER, a1 - inner)}A${INNER},${INNER} 0 ${large} 0 ${point(INNER, a0 + inner)}Z`
  );
}
