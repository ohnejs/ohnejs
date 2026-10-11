import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { inkStyle } from './_series.ts';
import '../tokens.ts';

/**
 * One line of a chart tooltip: a value, what it is, and the key that ties it to its mark.
 */
export interface TooltipRow {
  /**
   * The formatted value, set strong.
   */
  value: string;

  /**
   * What the value counts.
   */
  name: string;

  /**
   * The mark's key: a solid line, a dashed line, or a bar swatch.
   */
  mark: 'line' | 'dashed' | 'bar';

  /**
   * The palette slot the key paints in, `null` for "Other".
   */
  slot: number | null;
}

/**
 * The floating readout a chart shows for the position under the pointer or the keyboard.
 */
export interface ChartTooltip {
  /**
   * The element to append inside the chart's positioned stage.
   */
  root: HTMLElement;

  /**
   * Shows `rows` under `heading`, beside the stage-relative `x` and below `y`.
   */
  show: (x: number, heading: string, rows: TooltipRow[], y?: number) => void;

  /**
   * Hides the readout.
   */
  hide: () => void;
}

const OFFSET = 14;

css`
  .ohne-chart-tip {
    position: absolute;
    top: 0.25rem;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 8rem;
    max-width: 16rem;
    padding: 0.5rem 0.625rem;
    border-width: 1px;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    background-color: hsl(var(--ohne-popover));
    box-shadow: var(--ohne-shadow);
    color: hsl(var(--ohne-popover-foreground));
    font-size: 0.75rem;
    pointer-events: none;
  }

  .ohne-chart-tip[hidden] {
    display: none;
  }

  .ohne-chart-tip-head {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-chart-tip-row {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    white-space: nowrap;
  }

  .ohne-chart-tip-row strong {
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .ohne-chart-tip-row > span:last-child {
    overflow: hidden;
    color: hsl(var(--ohne-muted-foreground));
    text-overflow: ellipsis;
  }

  .ohne-chart-key {
    flex-shrink: 0;
    width: 0.875rem;
    border-top: 2px solid hsl(var(--ohne-chart-ink));
  }

  .ohne-chart-key-dashed {
    border-top-style: dashed;
  }

  .ohne-chart-key-bar {
    width: 0.625rem;
    height: 0.625rem;
    border: 0;
    border-radius: 2px;
    background-color: hsl(var(--ohne-chart-ink));
  }
`;

/**
 * The chart tooltip, placed beside a position and flipped to its left near the stage's right edge.
 * Its labels go in as text nodes, since names and categories are data.
 */
export function chartTooltip(): ChartTooltip {
  const root = h('div', { class: 'ohne-chart-tip', role: 'status', hidden: true });
  const show = (x: number, heading: string, rows: TooltipRow[], y?: number): void => {
    root.replaceChildren(
      h('div', { class: 'ohne-chart-tip-head' }, heading),
      ...rows.map((row) =>
        h(
          'div',
          { class: 'ohne-chart-tip-row' },
          chartKey(row.mark, row.slot),
          h('strong', null, row.value),
          h('span', null, row.name),
        ),
      ),
    );
    root.hidden = false;
    const room = (root.offsetParent as HTMLElement | null)?.clientWidth ?? 0;
    const width = root.offsetWidth;
    const left = x + OFFSET + width > room ? Math.max(0, x - OFFSET - width) : x + OFFSET;
    root.style.left = `${left}px`;
    root.style.top = isUndefined(y) ? '' : `${y}px`;
  };
  const hide = (): void => {
    root.hidden = true;
  };
  return { root, show, hide };
}

/**
 * The short key that ties a label to its mark: a line for lines, a swatch for bars and slices.
 */
export function chartKey(mark: TooltipRow['mark'], slot: number | null): HTMLElement {
  return h('span', {
    class: `ohne-chart-key ohne-chart-key-${mark}`,
    style: inkStyle(slot),
    'aria-hidden': 'true',
  });
}
