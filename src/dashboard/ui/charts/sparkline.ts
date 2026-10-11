import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { linePath } from '../../../utils/svg/line-path.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { svg } from '../../render/svg.ts';
import { skeleton } from '../states.ts';
import { inkStyle } from './_series.ts';
import '../tokens.ts';

/**
 * Options for `sparkline`.
 */
export interface SparklineOptions {
  /**
   * Washes the area under the line.
   *
   * @default
   * false
   */
  area?: boolean;
}

const WIDTH = 100;
const HEIGHT = 28;
const INSET = 2;

css`
  .ohne-sparkline {
    min-width: 6rem;
    height: 2rem;
  }

  .ohne-sparkline > svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .ohne-sparkline-line {
    fill: none;
    stroke: hsl(var(--ohne-chart-ink));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .ohne-sparkline-area {
    fill: hsl(var(--ohne-chart-ink) / 0.1);
  }
`;

/**
 * A small trend line that stretches to its box, two rem tall, in the first chart color.
 * It spans its lowest to its highest value, so it shows the shape of a trend, not its size.
 * It decorates a number printed beside it, so it has no axis, and a screen reader skips it.
 * `undefined` values hold the height with a placeholder; fewer than two values draw nothing.
 *
 * @example
 * ```ts
 * sparkline(() => realm.value?.onlineByHour, { area: true })
 * ```
 */
export function sparkline(
  values: () => readonly number[] | undefined,
  options: SparklineOptions = {},
): HTMLElement {
  return h('div', { class: 'ohne-sparkline', 'aria-hidden': 'true' }, () => {
    const current = values();
    if (isUndefined(current)) return skeleton({ height: '100%' });
    const root = svg('svg', {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      preserveAspectRatio: 'none',
      style: inkStyle(1),
    });
    if (current.length < 2) return root;
    const low = Math.min(...current);
    const span = Math.max(...current) - low || 1;
    const x = (index: number): number => (index / (current.length - 1)) * WIDTH;
    const y = (value: number): number =>
      HEIGHT - INSET - ((value - low) / span) * (HEIGHT - INSET * 2);
    if (options.area === true) {
      root.append(
        svg('path', {
          class: 'ohne-sparkline-area',
          d: linePath(current, x, y, { baseline: HEIGHT }),
        }),
      );
    }
    root.append(svg('path', { class: 'ohne-sparkline-line', d: linePath(current, x, y) }));
    return root;
  });
}
