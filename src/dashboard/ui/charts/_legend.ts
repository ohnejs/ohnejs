import type { TooltipRow } from './_tooltip.ts';

import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { chartKey } from './_tooltip.ts';
import '../tokens.ts';

/**
 * One entry of a chart legend.
 */
export interface LegendItem {
  /**
   * The series name in the active language, read reactively.
   */
  name: () => string;

  /**
   * The key mirroring the series' mark.
   */
  mark: TooltipRow['mark'];

  /**
   * The palette slot, `null` for "Other".
   */
  slot: number | null;
}

css`
  .ohne-chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0 0 0.5rem;
    padding: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    line-height: 1.125rem;
    list-style: none;
  }

  .ohne-chart-legend > li {
    display: inline-flex;
    gap: 0.375rem;
    align-items: center;
  }
`;

/**
 * The legend above a chart of two or more series; a single series gets none, since its title names it.
 * The names stay in the text ink, and the key beside each carries the series color.
 */
export function chartLegend(items: () => readonly LegendItem[]): () => HTMLElement | null {
  return () => {
    const current = items();
    if (current.length < 2) return null;
    return h(
      'ul',
      { class: 'ohne-chart-legend', 'aria-hidden': 'true' },
      current.map((item) =>
        h(
          'li',
          null,
          chartKey(item.mark, item.slot),
          h('span', null, () => item.name()),
        ),
      ),
    );
  };
}
