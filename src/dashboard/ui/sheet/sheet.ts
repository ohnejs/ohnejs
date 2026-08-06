import type { Child } from '../../render/insert.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { strokeFromKeyboardEvent } from '../../../utils/keys/stroke-from-keyboard-event.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { button } from '../button.ts';
import '../tokens.ts';
import { createSheetSelection, type SheetSelection } from './selection.ts';
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
 * The data source stays behind `SheetModel`; the sheet owns selection, keys, and paging chrome.
 * Click selects, Shift-click stretches, arrows move, PageUp and PageDown step pages.
 */
export function sheet<TRow>(model: SheetModel<TRow>): Child {
  const selection = createSheetSelection(() => ({
    rows: model.page()?.records.length ?? 0,
    columns: model.columns().length,
  }));

  const step = (delta: 1 | -1): void => {
    const current = model.page();
    if (isUndefined(current)) return;
    const next = clamp(current.page + delta, 1, current.lastPage);
    if (next === current.page) return;
    selection.clear();
    model.setPage(next);
  };

  const match = sheetKeymap({
    move: (dx, dy, extend) => selection.move(dx, dy, extend),
    selectAll: () => selection.selectAll(),
    clear: () => selection.clear(),
    page: step,
    edit: () => undefined,
  });

  const onKeydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof Element && !isNull(target.closest('a, button, input, select, textarea')))
      return;
    if (match(strokeFromKeyboardEvent(event))) event.preventDefault();
  };

  const onCellClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('td[data-row]');
    if (isNull(cell)) return;
    const address = {
      row: Number(cell.getAttribute('data-row')),
      column: Number(cell.getAttribute('data-column')),
    };
    if (event.shiftKey) selection.extend(address);
    else selection.set(address);
  };

  return h(
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
        { onClick: onCellClick },
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
                      class: () => cellClass(column(), selection, index(), columnIndex()),
                    },
                    model.cell(row, column()),
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
}

/**
 * The cell's class list: alignment plus its live selection state.
 */
function cellClass(
  column: SheetColumn,
  selection: SheetSelection,
  row: number,
  columnIndex: number,
): string {
  let classes = column.numeric ? 'numeric' : '';
  if (selection.isSelected(row, columnIndex)) classes += ' selected';
  if (selection.isFocus(row, columnIndex)) classes += ' focused';
  return classes;
}
