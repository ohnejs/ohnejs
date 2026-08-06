import type { Child } from '../../render/insert.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { strokeFromKeyboardEvent } from '../../../utils/keys/stroke-from-keyboard-event.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { button } from '../button.ts';
import '../tokens.ts';
import { type CellAddress, createSheetSelection, type SheetSelection } from './selection.ts';
import { sheetKeymap } from './sheet-keys.ts';

/**
 * One sheet column.
 */
export interface SheetColumn {
  /**
   * The column's stable identity.
   */
  key: string;

  /**
   * The header label.
   */
  label: string;

  /**
   * Right-aligns the column and renders its values with tabular numerals.
   *
   * @default
   * false
   */
  numeric?: boolean;
}

/**
 * One loaded page of rows, in the paginated envelope's shape.
 */
export interface SheetPage<TRow> {
  /**
   * The page's rows, in order.
   */
  records: readonly TRow[];

  /**
   * How many rows the whole set holds.
   */
  total: number;

  /**
   * The current page, starting at `1`.
   */
  page: number;

  /**
   * Rows per page.
   */
  perPage: number;

  /**
   * The last page number, at least `1`.
   */
  lastPage: number;
}

/**
 * What the sheet renders from; the data source stays behind this shape.
 * Every reader is reactive: the sheet re-renders what changes.
 */
export interface SheetModel<TRow> {
  /**
   * The columns, in order.
   */
  columns(): readonly SheetColumn[];

  /**
   * The current page; `undefined` while loading.
   */
  page(): SheetPage<TRow> | undefined;

  /**
   * A stable key for the row, used for keyed reconciliation.
   */
  rowKey(row: TRow, index: number): string;

  /**
   * Renders one cell's display content.
   * The `row` accessor is live; read it inside a nested function child to follow row updates.
   */
  cell(row: () => TRow, column: SheetColumn): Child;

  /**
   * Loads another page; the sheet clears its selection first.
   */
  setPage(page: number): void;

  /**
   * Whether the cell may open its inline editor; omitted allows every cell `editor` accepts.
   */
  canEdit?(row: TRow, column: SheetColumn): boolean;

  /**
   * Renders the cell's inline editor; `close` ends the edit and restores the grid's focus.
   * Returning nothing leaves the cell displaying, so a model refuses per cell by yielding `undefined`.
   * Omitted, the sheet is read-only.
   */
  editor?(row: () => TRow, column: SheetColumn, close: () => void): Child;

  /**
   * Marks the cell invalid, drawn with the danger ring; omitted marks none.
   */
  invalid?(row: TRow, column: SheetColumn): boolean;
}

css`
  .ohne-sheet {
    border: 1px solid var(--hairline);
    overflow: auto;
    outline: none;
    user-select: none;
  }

  .ohne-sheet table {
    border-collapse: separate;
    border-spacing: 0;
    width: max-content;
    min-width: 100%;
  }

  .ohne-sheet th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--paper);
    text-align: left;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
    padding: 7px 10px;
    border-bottom: 1px solid var(--hairline);
  }

  .ohne-sheet td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--hairline);
    border-right: 1px solid var(--hairline);
    white-space: nowrap;
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  .ohne-sheet td:last-child {
    border-right: none;
  }

  .ohne-sheet th.numeric,
  .ohne-sheet td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ohne-sheet td.selected {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .ohne-sheet td.focused {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .ohne-sheet td.invalid {
    box-shadow: inset 0 0 0 2px var(--danger);
  }

  .ohne-sheet td.editing {
    padding: 0;
    overflow: visible;
  }

  .ohne-sheet-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--hairline);
    margin-top: -1px;
    padding: 4px 10px;
  }

  .ohne-sheet-pageinfo {
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * The headless sheet, rendered: a sticky-headed grid with cell selection and keyboard control.
 * The data source stays behind `SheetModel`; the sheet owns selection, keys, editing, and paging chrome.
 * Click selects, Shift-click stretches, arrows move, PageUp and PageDown step pages.
 * Double-click or Enter opens the cell's inline editor when the model provides one.
 * Pass a `selection` to share it with surrounding chrome, like a batch-action toolbar.
 */
export function sheet<TRow>(model: SheetModel<TRow>, selection?: SheetSelection): Child {
  const owned =
    selection ??
    createSheetSelection(() => ({
      rows: model.page()?.records.length ?? 0,
      columns: model.columns().length,
    }));
  const editing = ref<CellAddress | null>(null);
  let container: HTMLElement | undefined;

  const closeEditor = (cell: CellAddress | null): void => {
    const active = editing.value;
    if (isNull(active)) return;
    if (!isNull(cell) && (active.row !== cell.row || active.column !== cell.column)) return;
    editing.value = null;
    container?.focus();
  };

  const openEditor = (cell: CellAddress): void => {
    if (isUndefined(model.editor)) return;
    const current = model.page();
    const rowValue = current?.records[cell.row];
    const column = model.columns()[cell.column];
    if (isUndefined(rowValue) || isUndefined(column)) return;
    if (model.canEdit?.(rowValue, column) === false) return;
    owned.set(cell);
    editing.value = cell;
  };

  const step = (delta: 1 | -1): void => {
    const current = model.page();
    if (isUndefined(current)) return;
    const next = clamp(current.page + delta, 1, current.lastPage);
    if (next === current.page) return;
    closeEditor(null);
    owned.clear();
    model.setPage(next);
  };

  const match = sheetKeymap({
    move: (dx, dy, extend) => owned.move(dx, dy, extend),
    selectAll: () => owned.selectAll(),
    clear: () => owned.clear(),
    page: step,
    edit: () => {
      const focus = owned.focus();
      if (!isNull(focus)) openEditor(focus);
    },
  });

  const interactive = (event: Event): boolean => {
    const target = event.target;
    return (
      target instanceof Element && !isNull(target.closest('a, button, input, select, textarea'))
    );
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (interactive(event)) return;
    if (match(strokeFromKeyboardEvent(event))) event.preventDefault();
  };

  const addressOf = (event: MouseEvent): CellAddress | null => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const cell = target.closest('td[data-row]');
    if (isNull(cell)) return null;
    return {
      row: Number(cell.getAttribute('data-row')),
      column: Number(cell.getAttribute('data-column')),
    };
  };

  const onCellClick = (event: MouseEvent): void => {
    if (interactive(event)) return;
    const address = addressOf(event);
    if (isNull(address)) return;
    if (event.shiftKey) owned.extend(address);
    else owned.set(address);
  };

  const onCellDblClick = (event: MouseEvent): void => {
    if (interactive(event)) return;
    const address = addressOf(event);
    if (!isNull(address)) openEditor(address);
  };

  container = h(
    'div',
    { class: 'ohne-sheet', tabindex: '0', onKeydown },
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          each(
            () => model.columns(),
            (column) => column.key,
            (column) =>
              h(
                'th',
                { class: () => (column().numeric ? 'numeric' : false) },
                () => column().label,
              ),
          ),
        ),
      ),
      h(
        'tbody',
        { onClick: onCellClick, onDblClick: onCellDblClick },
        each(
          () => model.page()?.records ?? [],
          (row, index) => model.rowKey(row, index),
          (row, index) =>
            h(
              'tr',
              null,
              each(
                () => model.columns(),
                (column) => column.key,
                (column, columnIndex) =>
                  h(
                    'td',
                    {
                      'data-row': () => String(index()),
                      'data-column': () => String(columnIndex()),
                      class: () =>
                        cellClass(
                          model,
                          column(),
                          owned,
                          editing.value,
                          row(),
                          index(),
                          columnIndex(),
                        ),
                    },
                    () => {
                      const active = editing.value;
                      const here =
                        !isNull(active) &&
                        active.row === index() &&
                        active.column === columnIndex();
                      if (here && !isUndefined(model.editor)) {
                        const child = model.editor(row, column(), () => closeEditor(active));
                        if (!isUndefined(child)) return child;
                      }
                      return model.cell(row, column());
                    },
                  ),
              ),
            ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'ohne-sheet-foot' },
      button('‹', {
        kind: 'ghost',
        onClick: () => step(-1),
        disabled: () => (model.page()?.page ?? 1) <= 1,
      }),
      h('span', { class: 'ohne-sheet-pageinfo' }, () => {
        const current = model.page();
        return isUndefined(current) ? '' : `${current.page} / ${current.lastPage}`;
      }),
      button('›', {
        kind: 'ghost',
        onClick: () => step(1),
        disabled: () => {
          const current = model.page();
          return isUndefined(current) || current.page >= current.lastPage;
        },
      }),
    ),
  );
  return container;
}

/**
 * The cell's class list: alignment plus its live selection, editing, and validity state.
 */
function cellClass<TRow>(
  model: SheetModel<TRow>,
  column: SheetColumn,
  selection: SheetSelection,
  editing: CellAddress | null,
  row: TRow,
  rowIndex: number,
  columnIndex: number,
): string {
  let classes = column.numeric ? 'numeric' : '';
  if (selection.isSelected(rowIndex, columnIndex)) classes += ' selected';
  if (selection.isFocus(rowIndex, columnIndex)) classes += ' focused';
  if (!isNull(editing) && editing.row === rowIndex && editing.column === columnIndex) {
    classes += ' editing';
  }
  if (model.invalid?.(row, column) === true) classes += ' invalid';
  return classes;
}
