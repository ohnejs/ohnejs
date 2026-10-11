import { isNull } from '../../../utils/is/is-null.ts';
import { getOrSet } from '../../../utils/map/get-or-set.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { niceScale } from '../../../utils/number/nice-scale.ts';
import { css } from '../../render/css.ts';
import { svg } from '../../render/svg.ts';
import '../tokens.ts';

/**
 * Where a plot sits once its value axis is drawn, and how a value maps onto it.
 */
export interface Axis {
  /**
   * The x where the plot starts, right of the tick labels.
   */
  left: number;

  /**
   * The plot's width.
   */
  inner: number;

  /**
   * The y of the baseline.
   */
  bottom: number;

  /**
   * The y of a value; a negative value sits on the baseline.
   */
  y: (value: number) => number;
}

/**
 * Options for `yAxis`.
 */
export interface AxisOptions {
  /**
   * The largest value the plot must fit.
   */
  peak: number;

  /**
   * Whether every value is whole, so the axis never steps by a fraction.
   */
  whole: boolean;

  /**
   * Formats a tick label.
   */
  format: (value: number) => string;

  /**
   * The plot's width and height in pixels.
   */
  size: [width: number, height: number];

  /**
   * The room kept above, below and right of the plot, in pixels.
   */
  margin: { top: number; bottom: number; right: number };
}

const AXIS_REM = 0.6875;
const LABEL_GAP = 8;
const FALLBACK_WIDTH = 7;
const CACHE_LIMIT = 1000;

const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null | undefined;

css`
  .ohne-chart-axis {
    fill: hsl(var(--ohne-muted-foreground));
    font-size: ${AXIS_REM}rem;
    font-variant-numeric: tabular-nums;
  }

  .ohne-chart-gridline {
    stroke: hsl(var(--ohne-border));
    stroke-width: 1;
  }

  .ohne-chart-baseline {
    stroke: hsl(var(--ohne-muted-foreground) / 0.4);
    stroke-width: 1;
  }

  .ohne-chart-label {
    fill: hsl(var(--ohne-foreground));
    font-size: ${AXIS_REM}rem;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
`;

/**
 * Draws a value axis into `plot`: gridlines and labels from `0` up a clean scale, sized beside the plot.
 * The labels get exactly the room the widest one measures, so a long currency never clips.
 */
export function yAxis(plot: SVGSVGElement, options: AxisOptions): Axis {
  const { margin } = options;
  const [width, height] = options.size;
  const bottom = height - margin.bottom;
  const scale = niceScale(
    options.peak,
    clamp(Math.floor((bottom - margin.top) / 40), 2, 5),
    options.whole,
  );
  const labels = scale.ticks.map((tick) => options.format(tick));
  const left = Math.ceil(Math.max(...labels.map((label) => textWidth(label)))) + LABEL_GAP;
  const inner = Math.max(1, width - left - margin.right);
  const y = (value: number): number =>
    bottom - (Math.max(0, value) / scale.max) * (bottom - margin.top);
  plot.setAttribute('width', String(width));
  plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const [index, tick] of scale.ticks.entries()) {
    plot.append(
      svg('line', {
        class: index === 0 ? 'ohne-chart-baseline' : 'ohne-chart-gridline',
        x1: left,
        x2: left + inner,
        y1: y(tick),
        y2: y(tick),
      }),
      axisLabel(labels[index]!, left - LABEL_GAP, y(tick), 'end', '0.32em'),
    );
  }
  return { left, inner, bottom, y };
}

/**
 * One axis label at `x` and `y`, in the muted text ink.
 */
export function axisLabel(
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
  dy?: string,
): SVGTextElement {
  return svg('text', { class: 'ohne-chart-axis', x, y, dy, 'text-anchor': anchor }, text);
}

/**
 * The width `text` takes as an axis label, in pixels, measured once per label.
 * Without a canvas to measure on, it estimates from the character count.
 */
export function textWidth(text: string): number {
  const context = (measurer ??= canvasContext());
  if (isNull(context)) return text.length * FALLBACK_WIDTH;
  if (widths.size > CACHE_LIMIT) widths.clear();
  // Tabular digits run a little wider than the canvas measures them.
  return getOrSet(widths, text, () => context.measureText(text).width * 1.05);
}

/**
 * `text` cut down with an ellipsis until it fits `width` pixels as an axis label.
 */
export function fitText(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  let end = text.length;
  while (end > 1 && textWidth(`${text.slice(0, end)}…`) > width) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * A 2D canvas context set in the axis font to measure on, or `null` where none exists.
 */
function canvasContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas') as Partial<HTMLCanvasElement>;
  const context = canvas.getContext?.('2d') ?? null;
  if (isNull(context)) return null;
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  context.font = `${AXIS_REM * root}px ${getComputedStyle(document.body).fontFamily}`;
  return context;
}
