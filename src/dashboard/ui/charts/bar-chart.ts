import type { Child } from '../../render/insert.ts';
import type { PlottedSeries, Series } from './_series.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { niceScale } from '../../../utils/number/nice-scale.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { svg } from '../../render/svg.ts';
import { formatNumber } from '../../runtime/number.ts';
import { useWidth } from '../use-width.ts';
import { axisLabel, fitText, textWidth, yAxis } from './_axis.ts';
import { dataFrame, dataTable } from './_frame.ts';
import { keyStep } from './_keys.ts';
import { chartLegend } from './_legend.ts';
import { inkStyle, plotSeries } from './_series.ts';
import { chartTooltip } from './_tooltip.ts';
import '../tokens.ts';

/**
 * Options for `barChart`.
 */
export interface BarChartOptions<T> {
  /**
   * The row's category label on the axis and atop its tooltip.
   */
  x: (row: T) => string;

  /**
   * The bars per row, each colored by its place in this list.
   * Past eight, the series from the eighth on fold into one "Other".
   */
  series: readonly Series<T>[];

  /**
   * Stacks a row's series into one bar instead of setting them side by side.
   *
   * @default
   * false
   */
  stacked?: boolean;

  /**
   * Lays the bars out sideways, one row per category, for many or long-named categories.
   * The height then follows the rows.
   *
   * @default
   * false
   */
  horizontal?: boolean;

  /**
   * The height of a vertical chart in pixels, the axis labels included.
   *
   * @default
   * 240
   */
  height?: number;

  /**
   * Formats a value for the axis, the labels, the tooltip and the screen reader table.
   * Omitted writes the number in the dashboard language, compact on the axis.
   */
  format?: (value: number) => string;
}

/**
 * Where one bar or stacked segment sits, in plot pixels along the value axis.
 */
interface Segment {
  series: number;
  from: number;
  to: number;
  offset: number;
  thickness: number;
  rounded: boolean;
}

/**
 * What a chart's layout draws from.
 */
interface Layout {
  labels: string[];
  series: PlottedSeries[];
  lanes: number;
  peak: number;
  whole: boolean;
  total: number;
  tall: number;
  band: number;
  format: (value: number) => string;
  axisFormat: (value: number) => string;
}

/**
 * How a chart draws: its row bands, its bar lanes, its labels, and the path of one segment.
 */
interface Drawing {
  bands: { start: number; size: number };
  lanes: number;
  thickness: number;
  labels: SVGElement[];
  bar: (index: number, segment: Segment) => string;
}

const TOP = 10;
const BOTTOM = 24;
const RIGHT = 4;
const GAP = 2;
const RADIUS = 4;
const MAX_BAR = 24;
const LANE = 12;
const SINGLE_LANE = 16;
const BAND_PAD = 12;
const LABEL_SPACE = 8;
const TICK_GAP = 80;
const MIN_LABEL_BAND = 48;

css`
  .ohne-chart-bar {
    fill: hsl(var(--ohne-chart-ink));
  }

  .ohne-chart-band {
    fill: hsl(var(--ohne-muted) / 0.8);
  }

  .ohne-chart-category {
    fill: hsl(var(--ohne-foreground));
    font-size: 0.75rem;
  }
`;

/**
 * A bar chart of one or more series per row: grouped side by side, or `stacked` into one bar.
 * Bars stay thin with a rounded data end, and a 2px surface gap parts touching bars and segments.
 * A `horizontal` chart names each row at its start, and a single series writes each value at its tip.
 * Each row's whole band is its hover and tap target, and the arrow keys step through the rows.
 * Loading holds the height with a placeholder; no rows show an empty state.
 *
 * @example
 * ```ts
 * barChart(() => raids.value, {
 *   x: (week) => week.label,
 *   stacked: true,
 *   series: [
 *     { name: 'Alliance', value: (week) => week.alliance },
 *     { name: 'Horde', value: (week) => week.horde },
 *   ],
 * })
 * ```
 */
export function barChart<T>(
  data: () => readonly T[] | undefined,
  options: BarChartOptions<T>,
): HTMLElement {
  const { height = 240 } = options;
  const legend = options.series.length > 1 ? ' + 1.625rem' : '';
  return h(
    'div',
    { class: 'ohne-bar-chart' },
    dataFrame(data, { height: `calc(${height}px${legend})` }, (rows) =>
      plot(rows, options, height),
    ),
  );
}

/**
 * The drawn chart for rows that have arrived.
 */
function plot<T>(rows: () => readonly T[], options: BarChartOptions<T>, height: number): Child {
  const horizontal = options.horizontal === true;
  const stacked = options.stacked === true;
  const format = options.format ?? ((value: number) => formatNumber(value));
  const axisFormat =
    options.format ??
    ((value: number) => formatNumber(value, { compact: Math.abs(value) >= 1000 }));
  const plotted = computed(() => plotSeries(rows(), options.series));
  const lanes = (): number => (stacked ? 1 : plotted.value.length);
  const band = (): number =>
    lanes() === 1 ? SINGLE_LANE + BAND_PAD : lanes() * LANE + (lanes() - 1) * GAP + BAND_PAD;
  const axisBand = (): number => (plotted.value.length === 1 ? GAP * 2 : BOTTOM);
  const plotHeight = (): number =>
    horizontal ? TOP + rows().length * band() + axisBand() : height;
  const active = ref<number | null>(null);
  const tooltip = chartTooltip();
  const highlight = svg('g');
  const canvas = svg('svg', {
    class: 'ohne-chart-plot',
    'aria-hidden': 'true',
  });
  let bands = { start: 0, size: 1 };

  const pick = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const offset = horizontal ? event.clientY - rect.top : event.clientX - rect.left;
    const index = Math.floor((offset - bands.start) / bands.size);
    active.value = index >= 0 && index < rows().length ? index : null;
  };

  const root = h(
    'div',
    {
      class: 'ohne-chart',
      tabindex: 0,
      role: 'group',
      'aria-label': () => plotted.value.map((one) => one.name()).join(', '),
      onPointerdown: pick,
      onPointermove: pick,
      onPointerleave: (event: PointerEvent) => {
        if (event.pointerType !== 'touch') active.value = null;
      },
      onFocus: () => (active.value ??= 0),
      onBlur: () => (active.value = null),
      onKeydown: (event: KeyboardEvent) => {
        const next = keyStep(event.key, active.value, rows().length, horizontal ? 'y' : 'x');
        if (isUndefined(next)) return;
        event.preventDefault();
        active.value = next;
      },
    },
    chartLegend(() =>
      plotted.value.map((one) => ({
        name: one.name,
        mark: 'bar' as const,
        slot: one.slot,
      })),
    ),
    h(
      'div',
      { class: 'ohne-chart-stage', style: () => `height: ${plotHeight()}px` },
      canvas,
      tooltip.root,
    ),
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
    const tall = plotHeight();
    canvas.replaceChildren();
    canvas.setAttribute('height', String(tall));
    if (total === 0) return;
    const peak = Math.max(
      0,
      ...current.map((_, index) =>
        stacked
          ? series.reduce((sum, one) => sum + Math.max(0, one.values[index] ?? 0), 0)
          : Math.max(0, ...series.map((one) => one.values[index] ?? 0)),
      ),
    );
    const whole = series.every((one) => one.values.every((value) => Number.isInteger(value ?? 0)));
    canvas.append(highlight);
    const layout: Layout = {
      labels: current.map((row) => options.x(row)),
      series,
      lanes: lanes(),
      peak,
      whole,
      total,
      tall,
      band: band(),
      format,
      axisFormat,
    };
    const draw = horizontal ? sideways(canvas, layout) : upright(canvas, layout);
    bands = draw.bands;
    for (const [index] of current.entries()) {
      for (const segment of segments(series, index, stacked, draw.thickness)) {
        const one = series[segment.series]!;
        canvas.append(
          svg('path', {
            class: 'ohne-chart-bar',
            style: inkStyle(one.slot),
            d: draw.bar(index, segment),
          }),
        );
      }
    }
    for (const label of draw.labels) canvas.append(label);
  });

  effect(() => {
    const index = active.value;
    const current = rows();
    const series = plotted.value;
    void width.value;
    highlight.replaceChildren();
    const row = isNull(index) ? undefined : current[index];
    if (isNull(index) || isUndefined(row)) {
      tooltip.hide();
      return;
    }
    const start = bands.start + bands.size * index;
    const across = horizontal ? Number(canvas.getAttribute('width')) : plotHeight() - BOTTOM - TOP;
    highlight.append(
      svg('rect', {
        class: 'ohne-chart-band',
        x: horizontal ? 0 : start,
        y: horizontal ? start : TOP,
        width: horizontal ? across : bands.size,
        height: horizontal ? bands.size : across,
        rx: RADIUS,
      }),
    );
    const lines = series.flatMap((one) => {
      const value = one.values[index] ?? null;
      return isNull(value)
        ? []
        : [
            {
              value: format(value),
              name: one.name(),
              mark: 'bar' as const,
              slot: one.slot,
            },
          ];
    });
    if (horizontal) tooltip.show(LABEL_SPACE, options.x(row), lines, start + bands.size);
    else tooltip.show(start + bands.size / 2, options.x(row), lines);
  });

  return root;
}

/**
 * Draws the axes of a vertical chart and answers how to draw a bar in it.
 */
function upright(canvas: SVGSVGElement, context: Layout): Drawing {
  const { labels, tall } = context;
  const { left, inner, y } = yAxis(canvas, {
    peak: context.peak,
    whole: context.whole,
    format: context.axisFormat,
    size: [context.total, tall],
    margin: { top: TOP, bottom: BOTTOM, right: RIGHT },
  });
  const size = inner / labels.length;
  const fitted = labels.map((label) => fitText(label, size - LABEL_SPACE));
  // Shortened labels that read alike name nothing, so every other label shows in full instead.
  const fits = size >= MIN_LABEL_BAND && new Set(fitted).size === new Set(labels).size;
  const gap = Math.max(...labels.map((label) => textWidth(label))) + LABEL_SPACE * 2;
  const every = fits ? 1 : Math.max(1, Math.ceil(gap / size));
  const ticks = labels.flatMap((label, index) => {
    if (index % every !== 0) return [];
    const text = fits ? fitted[index]! : label;
    return [axisLabel(text, left + size * (index + 0.5), tall - 6, 'middle')];
  });
  const { lanes } = context;
  const thickness = fit(size, lanes);
  return {
    bands: { start: left, size },
    lanes,
    thickness,
    labels: ticks,
    bar: (index, segment) => {
      const x0 = left + size * (index + 0.5) - (lanes * thickness + (lanes - 1) * GAP) / 2;
      const start = x0 + segment.offset;
      return roundedBar(
        'up',
        start,
        start + segment.thickness,
        y(segment.to),
        y(segment.from),
        segment,
      );
    },
  };
}

/**
 * Draws the labels and the value axis of a horizontal chart and answers how to draw a bar in it.
 */
function sideways(canvas: SVGSVGElement, context: Layout): Drawing {
  const { band, labels, series, total, tall } = context;
  const single = series.length === 1;
  const room = Math.min(
    Math.max(...labels.map((label) => textWidth(label))) + LABEL_SPACE * 2,
    total * 0.4,
  );
  const tips = single
    ? series[0]!.values.map((value) => (isNull(value) ? '' : context.format(value)))
    : [];
  const right = single ? Math.max(...tips.map((tip) => textWidth(tip))) + LABEL_SPACE : RIGHT;
  const inner = Math.max(1, total - room - right);
  const scale = niceScale(context.peak, Math.max(2, Math.floor(inner / TICK_GAP)), context.whole);
  const top = single ? Math.max(context.peak, Number.MIN_VALUE) : scale.max;
  const x = (value: number): number => room + (Math.max(0, value) / top) * inner;
  const bottom = TOP + labels.length * band;
  canvas.setAttribute('width', String(total));
  canvas.setAttribute('viewBox', `0 0 ${total} ${tall}`);
  const drawn: SVGElement[] = [];
  if (!single) {
    for (const [index, tick] of scale.ticks.entries()) {
      canvas.append(
        svg('line', {
          class: index === 0 ? 'ohne-chart-baseline' : 'ohne-chart-gridline',
          x1: x(tick),
          x2: x(tick),
          y1: TOP,
          y2: bottom,
        }),
      );
      drawn.push(
        axisLabel(context.axisFormat(tick), x(tick), tall - 6, index === 0 ? 'start' : 'middle'),
      );
    }
  }
  for (const [index, label] of labels.entries()) {
    const centre = TOP + band * (index + 0.5);
    drawn.push(
      svg(
        'text',
        {
          class: 'ohne-chart-category',
          x: room - LABEL_SPACE,
          y: centre,
          dy: '0.32em',
          'text-anchor': 'end',
        },
        fitText(label, room - LABEL_SPACE * 2),
      ),
    );
    const tip = tips[index];
    const value = series[0]?.values[index] ?? null;
    if (single && !isUndefined(tip) && !isNull(value)) {
      drawn.push(
        svg(
          'text',
          {
            class: 'ohne-chart-label',
            x: x(value) + LABEL_SPACE / 2,
            y: centre,
            dy: '0.32em',
          },
          tip,
        ),
      );
    }
  }
  const { lanes } = context;
  const thickness = lanes === 1 ? SINGLE_LANE : LANE;
  return {
    bands: { start: TOP, size: band },
    lanes,
    thickness,
    labels: drawn,
    bar: (index, segment) => {
      const y0 = TOP + band * (index + 0.5) - (lanes * thickness + (lanes - 1) * GAP) / 2;
      const start = y0 + segment.offset;
      return roundedBar(
        'right',
        x(segment.from),
        x(segment.to),
        start,
        start + segment.thickness,
        segment,
      );
    },
  };
}

/**
 * The bar thickness that fits `lanes` bars in a band: never past 24px, with air left over.
 */
function fit(size: number, lanes: number): number {
  const room = size * (lanes === 1 ? 0.7 : 0.8) - (lanes - 1) * GAP;
  return Math.max(1, Math.min(MAX_BAR, room / lanes, size - GAP));
}

/**
 * The segments of one row: one bar per series side by side, or one stack parted by surface gaps.
 */
function segments(
  series: readonly PlottedSeries[],
  index: number,
  stacked: boolean,
  thickness: number,
): Segment[] {
  const positive = series.map((one) => Math.max(0, one.values[index] ?? 0));
  if (!stacked) {
    return positive.flatMap((value, lane) =>
      value === 0
        ? []
        : [
            {
              series: lane,
              from: 0,
              to: value,
              offset: lane * (thickness + GAP),
              thickness,
              rounded: true,
            },
          ],
    );
  }
  const topmost = positive.findLastIndex((value) => value > 0);
  let sum = 0;
  return positive.flatMap((value, lane) => {
    if (value === 0) return [];
    const from = sum;
    sum += value;
    return [
      {
        series: lane,
        from,
        to: sum,
        offset: 0,
        thickness,
        rounded: lane === topmost,
      },
    ];
  });
}

/**
 * The path of a bar between two value positions, its data end rounded and its base square.
 * A segment resting on another leaves a 2px surface gap below it.
 */
function roundedBar(
  direction: 'up' | 'right',
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  segment: Segment,
): string {
  const parted = segment.from > 0 ? GAP : 0;
  if (direction === 'up') {
    const [x0, x1, top, bottom] = [a0, a1, b0, b1 - parted];
    if (bottom - top <= 0) return '';
    const r = segment.rounded ? Math.min(RADIUS, (x1 - x0) / 2, bottom - top) : 0;
    if (r === 0) return `M${x0},${bottom}V${top}H${x1}V${bottom}Z`;
    return (
      `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}` +
      `H${x1 - r}Q${x1},${top} ${x1},${top + r}V${bottom}Z`
    );
  }
  const [left, right, y0, y1] = [a0 + parted, a1, b0, b1];
  if (right - left <= 0) return '';
  const r = segment.rounded ? Math.min(RADIUS, (y1 - y0) / 2, right - left) : 0;
  if (r === 0) return `M${left},${y0}H${right}V${y1}H${left}Z`;
  return (
    `M${left},${y0}H${right - r}Q${right},${y0} ${right},${y0 + r}` +
    `V${y1 - r}Q${right},${y1} ${right - r},${y1}H${left}Z`
  );
}
