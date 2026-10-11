import type { Child } from '../../render/insert.ts';

import { isFunction } from '../../../utils/is/is-function.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { keyed } from '../../render/keyed.ts';
import { resourceState } from '../../runtime/resource.ts';
import { defaultText } from '../../runtime/text.ts';
import { emptyState, errorState, skeleton } from '../states.ts';
import '../tokens.ts';

/**
 * Options for `dataFrame`.
 */
export interface DataFrameOptions {
  /**
   * The CSS height every state holds, so the region never jumps as data arrives.
   */
  height: string;

  /**
   * The placeholder while the data loads.
   * Omitted is one solid block at `height`.
   */
  placeholder?: () => Child;
}

/**
 * A screen reader table: a header row, then one row per entry.
 */
export interface DataTable {
  /**
   * The column headings, the first over the row labels.
   */
  head: () => string[];

  /**
   * Each row's cells, the first being its label.
   */
  rows: () => string[][];
}

css`
  .ohne-chart {
    position: relative;
    width: 100%;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    touch-action: pan-y;
  }

  .ohne-chart:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-chart-stage {
    position: relative;
  }

  .ohne-chart-plot {
    display: block;
    overflow: visible;
  }

  .ohne-chart-stale {
    opacity: 0.5;
  }

  .ohne-chart-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .ohne-chart-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

/**
 * Shows `render` for rows, and holds `height` with a placeholder, an empty, an error or a locked state.
 * `undefined` rows load; `[]` is empty; a `Resource` that failed or got a `403` says so, with a retry.
 * `render` builds once each time rows arrive and gets a live getter, so new data patches in place.
 * While a `Resource` refetches for new parameters, the previous render holds, dimmed.
 */
export function dataFrame<T>(
  data: () => readonly T[] | undefined,
  options: DataFrameOptions,
  render: (rows: () => readonly T[]) => Child,
): () => Child {
  const { height, placeholder } = options;
  const phase = (): string => {
    const rows = data();
    if (!isUndefined(rows)) return rows.length === 0 ? 'empty' : 'ready';
    return resourceState(data) ?? 'loading';
  };
  const stale = (): boolean => {
    const { stale: check } = data as { stale?: unknown };
    return isFunction<() => boolean>(check) && check();
  };
  return keyed(phase, () => {
    const current = phase();
    if (current === 'ready') {
      return h(
        'div',
        {
          class: () => (stale() ? 'ohne-chart-ready ohne-chart-stale' : 'ohne-chart-ready'),
          'aria-busy': () => (stale() ? 'true' : undefined),
        },
        render(() => data() ?? []),
      );
    }
    const style = `min-height: ${height}`;
    if (current === 'empty') {
      return h(
        'div',
        { class: 'ohne-chart-state', style },
        emptyState(() => defaultText('dashboard.noData', 'No data yet'), { icon: 'chart-bar-off' }),
      );
    }
    if (current === 'forbidden') {
      return h(
        'div',
        { class: 'ohne-chart-state', style },
        emptyState(() => defaultText('dashboard.forbidden', 'You do not have access to this'), {
          icon: 'lock',
        }),
      );
    }
    if (current === 'error') {
      const { reload } = data as { reload?: unknown };
      return h(
        'div',
        { class: 'ohne-chart-state', style },
        errorState(undefined, { retry: isFunction(reload) ? () => void reload() : undefined }),
      );
    }
    return h('div', { 'aria-busy': 'true' }, placeholder?.() ?? skeleton({ height }));
  });
}

/**
 * The hidden table that carries a chart's numbers to a screen reader, rebuilt as they change.
 */
export function dataTable(table: DataTable): HTMLElement {
  return h(
    'div',
    { class: 'ohne-chart-sr' },
    h('table', null, () => [
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          table.head().map((cell) => h('th', { scope: 'col' }, cell)),
        ),
      ),
      h(
        'tbody',
        null,
        table.rows().map(([label, ...cells]) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, label),
            cells.map((cell) => h('td', null, cell)),
          ),
        ),
      ),
    ]),
  );
}
