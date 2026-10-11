import type { Child } from '../../render/insert.ts';
import type { PlottedSeries, Series } from './_series.ts';
import type { TooltipRow } from './_tooltip.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { linePath } from '../../../utils/svg/line-path.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { svg } from '../../render/svg.ts';
import { formatNumber } from '../../runtime/number.ts';
import { useWidth } from '../use-width.ts';
import { axisLabel, textWidth, yAxis } from './_axis.ts';
import { dataFrame, dataTable } from './_frame.ts';
import { keyStep } from './_keys.ts';
import { chartLegend } from './_legend.ts';
import { inkStyle, plotSeries } from './_series.ts';
import { chartTooltip } from './_tooltip.ts';
import '../tokens.ts';

/**
 * Options for `lineChart`.
 */
export interface LineChartOptions<T> {
  /**
   * The row's label on the x axis and atop its tooltip, like a day.
   */
  x: (row: T) => string;

  /**
   * The lines, each colored by its place in this list.
   * Past eight, the lines from the eighth on fold into one "Other".
   */
  series: readonly Series<T>[];

  /**
   * Washes the area under each solid line.
   *
   * @default
   * false
   */
  area?: boolean;

  /**
   * The chart's height in pixels, the x axis labels included.
   *
   * @default
   * 240
   */
  height?: number;

  /**
   * Formats a value for the axis, the tooltip and the screen reader table.
   * Omitted writes the number in the dashboard language, compact on the axis.
   */
  format?: (value: number) => string;

  /**
   * Whether a row covers only part of its span, like today, so the lines into it draw lighter.
   * A part day then never reads as a drop.
   */
  partial?: (row: T) => boolean;
}

const TOP = 10;
const BOTTOM = 24;
const RIGHT = 10;
const LABEL_SPACE = 8;
const NARROW = 320;
const LABEL_HEIGHT = 12;
const MAX_LABELED = 4;
const DOT = 4;

css`
  .ohne-chart-line {
    fill: none;
    stroke: hsl(var(--ohne-chart-ink));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ohne-chart-line-dashed {
    stroke-dasharray: 4 4;
  }

  .ohne-chart-line-partial {
    stroke-dasharray: 2 4;
    opacity: 0.6;
  }

  .ohne-chart-area {
    fill: hsl(var(--ohne-chart-ink) / 0.1);
  }

  .ohne-chart-dot {
    fill: hsl(var(--ohne-chart-ink));
    stroke: hsl(var(--ohne-card));
    stroke-width: 2;
  }

  .ohne-chart-cross {
    stroke: hsl(var(--ohne-muted-foreground) / 0.5);
    stroke-width: 1;
  }
`;

/**
 * A line chart of one or more series over the rows, `area` washing under each solid line.
 * A `null` value breaks its line, so a missing day never reads as zero.
 * One axis from zero, gridlines in the border ink, and the newest x label always shown.
 * Two or more series get a legend; up to four get their last value written at their end.
 * A crosshair follows the pointer, a tap or the arrow keys and reads every series at that row.
 * Loading holds the height with a placeholder; no rows show an empty state.
 *
 * @example
 * ```ts
 * lineChart(() => gold.value, {
 *   x: (day) => day.date,
 *   area: true,
 *   series: [
 *     { name: 'Gold looted', value: (day) => day.looted },
 *     { name: 'Last week', value: (day) => day.previous, dashed: true },
 *   ],
 * })
 * ```
 */
export function lineChart<T>(
  data: () => readonly T[] | undefined,
  options: LineChartOptions<T>,
): HTMLElement {
  const { height = 240 } = options;
  const legend = options.series.length > 1 ? ' + 1.625rem' : '';
  return h(
    'div',
    { class: 'ohne-line-chart' },
    dataFrame(data, { height: `calc(${height}px${legend})` }, (rows) =>
      plot(rows, options, height),
    ),
  );
}

/**
 * The drawn chart for rows that have arrived.
 */
function plot<T>(rows: () => readonly T[], options: LineChartOptions<T>, height: number): Child {
  const format = options.format ?? ((value: number) => formatNumber(value));
  const axisFormat =
    options.format ??
    ((value: number) => formatNumber(value, { compact: Math.abs(value) >= 1000 }));
  const plotted = computed(() => plotSeries(rows(), options.series));
  const active = ref<number | null>(null);
  const tooltip = chartTooltip();
  const crosshair = svg('g');
  const canvas = svg('svg', { class: 'ohne-chart-plot', height, 'aria-hidden': 'true' });
  let geometry = { left: 0, step: 0, x: (index: number) => index, y: (value: number) => value };

  const nearest = (event: PointerEvent): number | null => {
    const count = rows().length;
    if (count === 0) return null;
    if (count === 1) return 0;
    const offset = event.clientX - canvas.getBoundingClientRect().left - geometry.left;
    return clamp(Math.round(offset / geometry.step), 0, count - 1);
  };

  const root = h(
    'div',
    {
      class: 'ohne-chart',
      tabindex: 0,
      role: 'group',
      'aria-label': () => plotted.value.map((one) => one.name()).join(', '),
      onPointerdown: (event: PointerEvent) => (active.value = nearest(event)),
      onPointermove: (event: PointerEvent) => (active.value = nearest(event)),
      onPointerleave: (event: PointerEvent) => {
        if (event.pointerType !== 'touch') active.value = null;
      },
      onFocus: () => (active.value ??= rows().length - 1),
      onBlur: () => (active.value = null),
      onKeydown: (event: KeyboardEvent) => {
        const next = keyStep(event.key, active.value, rows().length);
        if (isUndefined(next)) return;
        event.preventDefault();
        active.value = next;
      },
    },
    chartLegend(() =>
      plotted.value.map((one) => ({
        name: one.name,
        mark: one.dashed ? 'dashed' : 'line',
        slot: one.slot,
      })),
    ),
    h('div', { class: 'ohne-chart-stage', style: `height: ${height}px` }, canvas, tooltip.root),
    dataTable({
      head: () => ['', ...plotted.value.map((one) => one.name())],
      rows: () =>
        rows().map((row, index) => [
          options.x(row),
          ...plotted.value.map((one) => {
            const value = one.values[index] ?? null;
            return isNull(value) ? '' : format(value);
          }),
        ]),
    }),
  );
  const width = useWidth(root);

  effect(() => {
    const current = rows();
    const series = plotted.value;
    const total = width.value;
    canvas.replaceChildren();
    if (total === 0) return;
    const values = series.flatMap((one) => one.values).filter((value) => !isNull(value));
    const ends = total >= NARROW && series.length <= MAX_LABELED ? endLabels(series, format) : [];
    const right = Math.max(RIGHT, ...ends.map((end) => textWidth(end.text) + LABEL_SPACE * 2));
    const { left, inner, bottom, y } = yAxis(canvas, {
      peak: Math.max(0, ...values),
      whole: values.every((value) => Number.isInteger(value)),
      format: axisFormat,
      size: [total, height],
      margin: { top: TOP, bottom: BOTTOM, right },
    });
    const count = current.length;
    const step = count > 1 ? inner / (count - 1) : 0;
    const x = (index: number): number => left + (count > 1 ? index * step : inner / 2);
    geometry = { left, step, x, y };

    const labels = current.map((row) => options.x(row));
    const gap = Math.max(...labels.map((label) => textWidth(label))) + LABEL_SPACE * 2;
    const every = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(inner / gap))));
    let previous = Infinity;
    for (let index = count - 1; index >= 0; index -= every) {
      const width = textWidth(labels[index]!);
      const last = index === count - 1 && count > 1;
      const first = index === 0 && count > 1;
      const anchor = last ? 'end' : first ? 'start' : 'middle';
      const at = last ? left + inner : x(index);
      const start = anchor === 'start' ? at : anchor === 'end' ? at - width : at - width / 2;
      if (start < left - LABEL_SPACE || start + width > previous - LABEL_SPACE) break;
      canvas.append(axisLabel(labels[index]!, at, height - 6, anchor));
      previous = start;
    }

    const partial = (index: number): boolean => {
      const { partial: covers } = options;
      if (isUndefined(covers)) return false;
      const from = current[index];
      const to = current[index + 1];
      return (!isUndefined(from) && covers(from)) || (!isUndefined(to) && covers(to));
    };
    for (const one of series) {
      const group = svg('g', { style: inkStyle(one.slot) });
      const line = `ohne-chart-line${one.dashed ? ' ohne-chart-line-dashed' : ''}`;
      if (options.area === true && !one.dashed) {
        group.append(
          svg('path', {
            class: 'ohne-chart-area',
            d: linePath(one.values, x, y, { baseline: bottom }),
          }),
        );
      }
      group.append(
        svg('path', { class: line, d: linePath(one.values, x, y, { joins: (i) => !partial(i) }) }),
        svg('path', {
          class: `${line} ohne-chart-line-partial`,
          d: linePath(one.values, x, y, { joins: partial }),
        }),
      );
      for (const [index, value] of one.values.entries()) {
        const alone =
          isNull(one.values[index - 1] ?? null) && isNull(one.values[index + 1] ?? null);
        if (!isNull(value) && alone) {
          group.append(
            svg('circle', { class: 'ohne-chart-dot', cx: x(index), cy: y(value), r: DOT }),
          );
        }
      }
      canvas.append(group);
    }
    const placed = ends.map((end) => ({ ...end, at: y(end.value) })).sort((a, b) => a.at - b.at);
    const apart = placed.every(
      (end, index) => index === 0 || end.at - placed[index - 1]!.at >= LABEL_HEIGHT,
    );
    if (apart) {
      for (const end of placed) {
        canvas.append(
          svg(
            'text',
            { class: 'ohne-chart-label', x: x(end.index) + LABEL_SPACE, y: end.at, dy: '0.32em' },
            end.text,
          ),
        );
      }
    }
    canvas.append(crosshair);
  });

  effect(() => {
    const index = active.value;
    const current = rows();
    const series = plotted.value;
    void width.value;
    crosshair.replaceChildren();
    const row = isNull(index) ? undefined : current[index];
    if (isNull(index) || isUndefined(row)) {
      tooltip.hide();
      return;
    }
    const at = geometry.x(index);
    crosshair.append(
      svg('line', { class: 'ohne-chart-cross', x1: at, x2: at, y1: TOP, y2: height - BOTTOM }),
    );
    const lines: TooltipRow[] = [];
    for (const one of series) {
      const value = one.values[index] ?? null;
      if (isNull(value)) continue;
      crosshair.append(
        svg('circle', {
          class: 'ohne-chart-dot',
          style: inkStyle(one.slot),
          cx: at,
          cy: geometry.y(value),
          r: DOT,
        }),
      );
      lines.push({
        value: format(value),
        name: one.name(),
        mark: one.dashed ? 'dashed' : 'line',
        slot: one.slot,
      });
    }
    tooltip.show(at, options.x(row), lines);
  });

  return root;
}

/**
 * The value each series ends the chart on, to write beside the line's end.
 * A series that stops before the last row gets none, since its end sits inside the plot.
 */
function endLabels(
  series: readonly PlottedSeries[],
  format: (value: number) => string,
): { index: number; value: number; text: string }[] {
  return series.flatMap((one) => {
    const index = one.values.length - 1;
    const value = one.values[index] ?? null;
    return isNull(value) ? [] : [{ index, value, text: format(value) }];
  });
}
