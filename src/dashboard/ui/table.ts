import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { TableColumn, TableColumns, TableCell, TableRow, TableSort } from './table-model.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { button } from './button.ts';
import { checkbox } from './checkbox.ts';
import { icon } from './icon.ts';
import { rangeSelect, toggleSort } from './table-model.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * Text labels for interactive UI elements of a `table`.
 */
export interface TableLabels {
  /**
   * Text shown as `title` attribute for the row actions menu button.
   *
   * @default
   * 'Actions'
   */
  actions?: string;

  /**
   * Text displayed on the button that sorts rows in ascending order (A-Z, 0-9).
   *
   * @default
   * 'Sort in ascending order'
   */
  sortInAscendingOrder?: string;

  /**
   * Text displayed on the button that sorts rows in descending order (Z-A, 9-0).
   *
   * @default
   * 'Sort in descending order'
   */
  sortInDescendingOrder?: string;

  /**
   * Text shown in the tooltip of the select all checkbox when all items are selected.
   * Omitted shows no tooltip.
   */
  selectAll?: string;

  /**
   * Text shown in the tooltip of the select all checkbox when some but not all items are selected.
   * Omitted shows no tooltip.
   */
  selectAllIndeterminate?: string;

  /**
   * Text shown when there is no data to display in the table.
   *
   * @default
   * 'No data available'
   */
  noData?: string;
}

/**
 * Options for `table`.
 */
export interface TableOptions<TColumns extends TableColumns> {
  /**
   * The column definitions.
   * Insertion order defines the column order.
   */
  columns: TColumns;

  /**
   * The data rows to display, read reactively.
   * Rows are keyed by `row.id`; any change resets the open actions menu and the shift anchor.
   * Omitted renders the empty state.
   */
  data?: () => TableRow<TColumns>[];

  /**
   * The sorting state, two-way: sort button clicks write the toggled state back.
   * Omitted disables the sorting model; sort buttons still render for sortable columns.
   */
  sort?: Ref<TableSort<TColumns>>;

  /**
   * Whether the table rows are selectable, read reactively.
   * While it returns `true` a leading checkbox column renders.
   */
  selectable?: () => boolean;

  /**
   * The selection map from row id to selection state, two-way.
   * Row checkbox toggles write a fresh object back; shift-clicks range from the anchor row.
   */
  selected?: Ref<Record<number | string, boolean>>;

  /**
   * The state of the select all checkbox, read reactively.
   * Bookkeeping is entirely the caller's job: recompute it in response to selection changes.
   * Omitted keeps the checkbox unchecked.
   */
  selectAllState?: () => boolean | 'indeterminate';

  /**
   * Whether to display an empty state message when the table has no data, read reactively.
   * Omitted always shows it.
   */
  showEmptyState?: () => boolean;

  /**
   * Called when the user opens the actions menu for a row.
   * Receives the current row and its index, and can return a promise to delay the opening.
   */
  onOpenActions?: (context: { row: TableRow<TColumns>; rowIndex: number }) => void | Promise<void>;

  /**
   * Text labels for interactive UI elements; a getter reads reactively.
   */
  labels?: TableLabels | (() => TableLabels);

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Renders one header cell's content in place of the default column label span.
   */
  header?: (payload: { column: TableColumn; key: string; columnIndex: number }) => Child;

  /**
   * Renders one data cell's content in place of the default `row[key]` div.
   * The content should be a single wrapping element - the CSS sizes `th/td > *`, not the cell.
   */
  cell?: (payload: TableCell<TColumns>) => Child;

  /**
   * Renders one row's actions panel; its presence adds the trailing actions column.
   * Called while the row's menu is open, anchored to `reference`; call `close` to dismiss.
   * The panel floats itself - pass a dropdown built on the floating engine.
   */
  actions?: (payload: {
    row: TableRow<TColumns>;
    rowIndex: number;
    reference: HTMLElement;
    close: () => void;
  }) => Child;

  /**
   * Rendered in place of the default "no data" paragraph when the table is empty.
   */
  empty?: Child | (() => Child);

  /**
   * Called when the select all checkbox toggles, with the checkbox's new value.
   * The caller fills or clears `selected` and recomputes `selectAllState`.
   */
  onSelectAll?: (value: boolean) => void;

  /**
   * Called when a row is double-clicked.
   * The text selection the double-click made is cleared first.
   */
  onDoubleClick?: (row: TableRow<TColumns>, event: MouseEvent) => void;
}

/**
 * A mounted table: the root element plus the shift-range anchor.
 */
export interface Table {
  /**
   * The root `<table>` element to insert into the tree.
   */
  root: HTMLElement;

  /**
   * The row id anchoring the next shift-click range, or `null`.
   * Writable: a caller that selects a row programmatically seeds it.
   * A following shift-click then ranges from that row.
   */
  selectOrigin: Ref<number | string | null>;
}

css`
  .ohne-table {
    display: table;
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    text-indent: 0;
    vertical-align: middle;
  }

  .ohne-table :where(thead) {
    border-bottom-width: 1px;
  }

  .ohne-table :where(th, td) {
    border-bottom-width: 1px;
    text-align: start;
  }

  .ohne-table :where(th, td) > :where(*) {
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-table :where(th) {
    position: sticky;
    z-index: 11;
    top: 0;
    padding: 0.6875rem 0.75rem;
    padding-right: 0;
    background-color: hsl(var(--ohne-background));
    font-weight: 500;
  }

  .ohne-table :where(td) {
    padding: 0.5rem 0.75rem;
    padding-right: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-table-selectable :where(th, td):first-child {
    position: sticky;
    z-index: 12;
    left: 0;
    background-color: hsl(var(--ohne-background));
  }

  .ohne-table-selectable :where(th):first-child {
    z-index: 13 !important;
  }

  .ohne-table :where(th, td):last-child {
    padding-right: 0.75rem;
  }

  .ohne-table :where(th):last-child {
    pointer-events: none;
  }

  .ohne-table-has-actions :where(th, td):last-child {
    position: sticky;
    right: 0;
  }

  .ohne-table-has-actions :where(th):not(:last-child) {
    z-index: 12;
  }

  .ohne-table-has-actions :where(td):last-child {
    background-color: transparent;
  }

  .ohne-table-cell-active-actions {
    z-index: 13;
  }

  .ohne-table-header {
    display: flex;
    align-items: center;
  }

  .ohne-table-column-label {
    padding-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-table-button-wrapper {
    flex-shrink: 0;
    display: flex;
    height: calc(2 * (1rem + var(--ohne-size) * 0.125rem) + 0.25rem);
  }

  .ohne-table-sort-button-wrapper > * {
    margin-left: 0.5rem;
  }

  .ohne-table-action-button-wrapper {
    justify-content: flex-end;
  }

  /* Opacity, not display, so the buttons stay tabbable and reveal on keyboard focus. */
  .ohne-table :where(th):not(:hover) .ohne-table-sort-button:not(:focus-visible) {
    opacity: 0;
  }

  .ohne-table :where(tr):not(:hover) .ohne-table-action-button:not(:focus-visible) {
    opacity: 0;
  }
`;

const shiftHeld = ref(false);
let shiftTracked = false;

// The source's useMagicKeys tracks Shift on the window; the flag can stick when focus leaves
// mid-hold, exactly as there.
function trackShift(): void {
  if (shiftTracked) return;
  shiftTracked = true;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') shiftHeld.value = true;
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') shiftHeld.value = false;
  });
}

/**
 * A fixed-layout data table, ported 1-to-1 from Pruvious v4's `PUITable`.
 * It brings a sticky header and edge columns, per-column sort toggles, and shift-range selection.
 * A per-row actions menu and an empty state round it out.
 * Column widths come only from the `<colgroup>`.
 * The table sets no height and never scrolls - put it inside a scroll container.
 * Sort and action buttons hide off-hover through CSS; the sorted column and the open menu stay visible.
 * Selection bookkeeping lives in the caller.
 * `onSelectAll` fills or clears `selected`, and selection writes are recomputed into `selectAllState` there.
 *
 * @example
 * ```ts
 * const sort = ref<TableSort<typeof columns>>(null)
 * const grid = table({ columns, data: () => rows.value, sort })
 * parent.append(grid.root)
 * ```
 */
export function table<TColumns extends TableColumns>(options: TableOptions<TColumns>): Table {
  trackShift();

  const rows = (): TableRow<TColumns>[] => options.data?.() ?? [];
  const labels = (): TableLabels =>
    (isFunction<() => TableLabels>(options.labels) ? options.labels() : options.labels) ?? {};
  const selectable = (): boolean => options.selectable?.() ?? false;
  const selectAllState = (): boolean | 'indeterminate' => options.selectAllState?.() ?? false;
  const sortValue = (): TableSort<TColumns> => options.sort?.value ?? null;
  const selectedValue = (): Record<number | string, boolean> => options.selected?.value ?? {};
  const buttonSize = isUndefined(options.size) ? -3 : options.size - 2;
  // Safari ignores min-width on <col>, so its cols take the minimum as the width instead.
  const isSafari =
    window.navigator.userAgent.includes('Safari') && !window.navigator.userAgent.includes('Chrome');
  const entries = Object.entries(options.columns) as [string, TableColumn][];
  const visibleActions = ref(-1);
  const selectOrigin = ref<number | string | null>(null);

  let previousRows: readonly TableRow<TColumns>[] | undefined;
  effect(() => {
    const current = rows();
    if (previousRows !== undefined && current !== previousRows) {
      visibleActions.value = -1;
      selectOrigin.value = null;
    }
    previousRows = current;
  });

  const writeSelected = (next: Record<number | string, boolean>): void => {
    if (options.selected) options.selected.value = next;
  };

  const select = (id: number | string, value: boolean): void => {
    selectOrigin.value = value ? id : null;
    writeSelected({ ...untracked(selectedValue), [id]: value });
  };

  const shiftSelect = (id: number | string, value: boolean): void => {
    const origin = untracked(() => selectOrigin.value);
    if (isNull(origin)) {
      select(id, value);
    } else if (origin !== id) {
      writeSelected(rangeSelect(untracked(rows), untracked(selectedValue), origin, id, value));
    }
  };

  const applySort = (key: keyof TColumns): void => {
    const sort = options.sort;
    if (sort)
      sort.value = toggleSort(
        untracked(() => sort.value),
        key,
      );
  };

  const sortIcon = (key: string, sortable: boolean | 'text' | 'numeric'): SVGSVGElement => {
    const sort = sortValue();
    if (!sort || sort.column !== key) return icon('arrows-sort');
    const ascending = sort.direction === 'asc';
    if (sortable === 'numeric') {
      return icon(ascending ? 'sort-ascending-numbers' : 'sort-descending-numbers');
    }
    if (sortable === 'text') {
      return icon(ascending ? 'sort-ascending-letters' : 'sort-descending-letters');
    }
    return icon(ascending ? 'sort-ascending' : 'sort-descending');
  };

  const selectAllModel: Ref<boolean> = {
    get value() {
      return Boolean(selectAllState());
    },
    set value(next) {
      options.onSelectAll?.(next);
    },
  };
  const selectAllBox = checkbox(selectAllModel, undefined, {
    variant: 'accent',
    indeterminate: () => selectAllState() === 'indeterminate',
  });
  selectAllBox.classList.add('ohne-table-select-all');
  onCleanup(
    attachTooltip(selectAllBox, () => {
      const state = selectAllState();
      return state === 'indeterminate'
        ? (labels().selectAllIndeterminate ?? null)
        : state
          ? (labels().selectAll ?? null)
          : null;
    }),
  );

  const headerCell = (key: string, column: TableColumn, columnIndex: number): HTMLElement => {
    const children: Child[] = [
      options.header
        ? options.header({ column, key, columnIndex })
        : h('span', { class: 'ohne-table-column-label' }, column.label ?? key),
    ];
    const sortable = column.sortable;
    if (sortable) {
      const sortButton = button(() => sortIcon(key, sortable), {
        variant: 'secondary',
        class: 'ohne-table-sort-button',
        onClick: () => applySort(key as keyof TColumns),
      });
      batchedEffect(() => {
        const sort = sortValue();
        sortButton.title =
          sort?.column === key && sort.direction === 'asc'
            ? (labels().sortInDescendingOrder ?? 'Sort in descending order')
            : (labels().sortInAscendingOrder ?? 'Sort in ascending order');
        sortButton.style.opacity = sort?.column === key ? '1' : '';
      });
      children.push(
        h(
          'div',
          {
            class: 'ohne-table-button-wrapper ohne-table-sort-button-wrapper',
            style: `--ohne-size: ${buttonSize}`,
          },
          sortButton,
        ),
      );
    }
    return h('th', { scope: 'col' }, h('div', { class: 'ohne-table-header' }, children));
  };

  const selectCell = (row: () => TableRow<TColumns>): HTMLElement => {
    const model: Ref<boolean> = {
      get value() {
        return Boolean(selectedValue()[row().id]);
      },
      set value(next) {
        if (untracked(() => shiftHeld.value)) shiftSelect(row().id, next);
        else select(row().id, next);
      },
    };
    return h(
      'td',
      null,
      checkbox(model, undefined, {
        variant: 'accent',
        disabled: () => shiftHeld.value && selectOrigin.value === row().id,
      }),
    );
  };

  const actionsCell = (
    actions: NonNullable<TableOptions<TColumns>['actions']>,
    row: () => TableRow<TColumns>,
    rowIndex: () => number,
  ): HTMLElement => {
    const close = (): void => {
      visibleActions.value = -1;
    };
    const actionButton = button(icon('dots'), {
      class: 'ohne-table-action-button',
      onClick: async () => {
        await options.onOpenActions?.({ row: untracked(row), rowIndex: untracked(rowIndex) });
        const index = untracked(rowIndex);
        visibleActions.value = untracked(() => visibleActions.value) === index ? -1 : index;
      },
    });
    batchedEffect(() => {
      actionButton.title = labels().actions ?? 'Actions';
      actionButton.style.opacity = visibleActions.value === rowIndex() ? '1' : '';
    });
    return h(
      'td',
      {
        class: () =>
          visibleActions.value === rowIndex() ? 'ohne-table-cell-active-actions' : null,
      },
      h(
        'div',
        {
          class: 'ohne-table-button-wrapper ohne-table-action-button-wrapper',
          style: `--ohne-size: ${buttonSize}`,
        },
        actionButton,
        when(
          () => visibleActions.value === rowIndex(),
          () => actions({ row: row(), rowIndex: rowIndex(), reference: actionButton, close }),
        ),
      ),
    );
  };

  const dataRow = (row: () => TableRow<TColumns>, rowIndex: () => number): HTMLElement => {
    const cells: Child[] = [when(selectable, () => selectCell(row))];
    entries.forEach(([key, column], columnIndex) => {
      cells.push(
        h('td', null, () => {
          if (options.cell) {
            return options.cell({ row: row(), rowIndex: rowIndex(), column, key, columnIndex });
          }
          const value = (row() as Record<string, unknown>)[key];
          return h('div', null, isNullish(value) ? '' : String(value));
        }),
      );
    });
    if (options.actions) cells.push(actionsCell(options.actions, row, rowIndex));
    return h(
      'tr',
      {
        onDblclick: (event: MouseEvent) => {
          window.getSelection()?.removeAllRanges();
          options.onDoubleClick?.(row(), event);
        },
      },
      cells,
    );
  };

  const emptyBody = (): HTMLElement =>
    h(
      'tbody',
      null,
      h(
        'tr',
        null,
        h(
          'td',
          { colspan: () => entries.length + (selectable() ? 1 : 0) + (options.actions ? 1 : 0) },
          when(
            () => options.showEmptyState?.() ?? true,
            () =>
              options.empty ??
              h('p', { class: 'ohne-center' }, () => labels().noData ?? 'No data available'),
          ),
        ),
      ),
    );

  const root = h(
    'table',
    {
      class: () =>
        'ohne-table' +
        (selectable() ? ' ohne-table-selectable' : '') +
        (options.actions ? ' ohne-table-has-actions' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    h(
      'colgroup',
      null,
      when(selectable, () =>
        h('col', {
          style: `width: calc((1rem + var(--ohne-size) * 0.125rem) + 1.125rem); --ohne-size: ${buttonSize}`,
        }),
      ),
      entries.map(([, column]) => {
        const width = column.width ?? (isSafari ? column.minWidth : undefined);
        let style = '';
        if (width !== undefined) style += `width: ${width};`;
        if (column.minWidth !== undefined) style += ` min-width: ${column.minWidth};`;
        return h('col', { style: style === '' ? undefined : style.trim() });
      }),
      options.actions
        ? h('col', {
            style: `width: calc(2 * (1rem + var(--ohne-size) * 0.125rem) + 1.75rem); --ohne-size: ${buttonSize}`,
          })
        : null,
    ),
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        when(selectable, () => h('th', null, selectAllBox)),
        entries.map(([key, column], columnIndex) => headerCell(key, column, columnIndex)),
        options.actions ? h('th') : null,
      ),
    ),
    when(
      () => rows().length > 0,
      () =>
        h(
          'tbody',
          null,
          each(rows, (row) => row.id, dataRow),
        ),
      emptyBody,
    ),
  );

  return { root, selectOrigin };
}
