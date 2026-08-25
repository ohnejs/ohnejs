import type { Child } from '../../render/insert.ts';
import type { RowChecks } from './checks.ts';

import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { strokeFromKeyboardEvent } from '../../../utils/keys/stroke-from-keyboard-event.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { when } from '../../render/when.ts';
import { button } from '../button.ts';
import { icon } from '../icon.ts';
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

  /**
   * Centers the column, for marks like a boolean check or a list count.
   *
   * @default
   * false
   */
  center?: boolean;

  /**
   * A fixed column width in pixels.
   * Omitted, the column sizes to its content and shares the remaining room.
   */
  width?: number;
}

/**
 * One keyboard hint the sheet's footer lists.
 */
export interface SheetHint {
  /**
   * The stroke, written the way the platform shows it, like `⇧click`.
   */
  keys: string;

  /**
   * What the stroke does, in one or two words.
   */
  label: string;
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
   * A stable key for the row, used for keyed reconciliation and for the check set.
   */
  rowKey(row: TRow, index: number): string;

  /**
   * Renders one cell's display content.
   * The `row` accessor is live; read it inside a nested function child to follow row updates.
   */
  cell(row: () => TRow, column: SheetColumn): Child;

  /**
   * Loads another page; the sheet clears its cursor and checks first.
   */
  setPage(page: number): void;

  /**
   * The row-check model bulk actions read; omitted, the gutter shows plain row numbers.
   */
  checks?: RowChecks;

  /**
   * The record page the row's gutter anchor opens; yielding `undefined` renders no anchor.
   * Omitted, no row carries an open affordance.
   */
  rowHref?(row: TRow): string | undefined;

  /**
   * Opens the row, from `mod+Enter` on the cursor row and from Enter on a cell that cannot edit in place.
   * `column` names the cell that asked, so a composite can deep-link its field.
   */
  open?(row: TRow, column?: SheetColumn): void;

  /**
   * The gutter anchor's accessible name.
   *
   * @default
   * 'open'
   */
  openLabel?(): string;

  /**
   * The active sort; `undefined` when the default order stands.
   */
  sort?(): { key: string; desc: boolean } | undefined;

  /**
   * Cycles the sort on a header click; the model owns the asc-desc-default cycle.
   */
  toggleSort?(key: string): void;

  /**
   * Whether the column's header toggles sorting; omitted, no header does.
   */
  sortable?(column: SheetColumn): boolean;

  /**
   * Whether the current load failed; with no page loaded, the sheet renders `failure`, not the skeleton.
   */
  failed?(): boolean;

  /**
   * Renders what fills the grid when `failed` reports true.
   */
  failure?(): Child;

  /**
   * While true, checked gutter cells tint with the danger wash - the armed-delete warning.
   */
  dangerRows?(): boolean;

  /**
   * Whether the cell may open its inline editor; omitted allows every cell `editor` accepts.
   */
  canEdit?(row: TRow, column: SheetColumn): boolean;

  /**
   * Renders the cell's inline editor; `close` ends the edit and restores the grid's focus.
   * Returning nothing leaves the cell displaying, so a model refuses per cell by yielding `undefined`.
   * The build runs untracked: a row update never rebuilds an open editor over the user's input.
   * Omitted, the sheet is read-only.
   */
  editor?(row: () => TRow, column: SheetColumn, close: () => void): Child;

  /**
   * Marks the cell invalid, drawn with the danger ring; omitted marks none.
   */
  invalid?(row: TRow, column: SheetColumn): boolean;

  /**
   * Renders what fills the grid when the loaded page holds no rows.
   * The sheet owns the loading state itself, so this covers only the answered-and-empty case.
   * Omitted leaves the grid blank.
   */
  empty?(): Child;

  /**
   * The keyboard hints the footer lists, left of the pager; omitted lists none.
   */
  hints?(): readonly SheetHint[];
}

css`
  .ohne-sheet {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    overflow: hidden;
    outline: none;
    user-select: none;
  }

  .ohne-sheet-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
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
    z-index: 2;
    height: var(--row);
    background: var(--surface);
    text-align: left;
    font-family: var(--mono);
    font-size: var(--fs-caps);
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--faint);
    padding: 0 var(--s3);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  .ohne-sheet th.sortable {
    cursor: pointer;
    transition: color var(--pace);
  }

  .ohne-sheet th.sortable:hover {
    color: var(--dim);
  }

  .ohne-sheet-sort {
    margin-left: 4px;
    color: var(--faint);
  }

  .ohne-sheet td {
    height: var(--row);
    box-sizing: border-box;
    padding: 0 var(--s3);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  .ohne-sheet tbody tr:hover td {
    background: var(--surface);
  }

  .ohne-sheet th.numeric,
  .ohne-sheet td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ohne-sheet th.center,
  .ohne-sheet td.center {
    text-align: center;
  }

  .ohne-sheet td.selected,
  .ohne-sheet tbody tr:hover td.selected {
    background: var(--accent-wash);
  }

  .ohne-sheet td.focused {
    position: relative;
    z-index: 1;
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .ohne-sheet td.invalid {
    box-shadow: inset 0 0 0 1px var(--danger);
  }

  .ohne-sheet td.editing {
    padding: 0;
    overflow: visible;
  }

  .ohne-sheet .gutter {
    position: sticky;
    left: 0;
    width: 56px;
    min-width: 56px;
    padding: 0;
    background: var(--bg);
  }

  .ohne-sheet th.gutter {
    z-index: 3;
    background: var(--surface);
  }

  .ohne-sheet tbody tr:hover td.gutter {
    background: var(--surface);
  }

  .ohne-sheet td.gutter.armed,
  .ohne-sheet tbody tr:hover td.gutter.armed {
    background: var(--danger-wash);
  }

  .ohne-sheet td.gutter.armed .ohne-sheet-tick.on {
    background: var(--danger);
    border-color: var(--danger);
  }

  .ohne-sheet-gutter {
    display: flex;
    align-items: center;
    height: var(--row);
  }

  .ohne-sheet-gutter-check {
    flex: none;
    width: 28px;
    display: grid;
    place-items: center;
  }

  .ohne-sheet-rownum {
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--faint);
  }

  .ohne-sheet td.gutter .ohne-sheet-tick {
    display: none;
  }

  .ohne-sheet.has-checks td.gutter .ohne-sheet-tick,
  .ohne-sheet tbody tr:hover td.gutter .ohne-sheet-tick,
  .ohne-sheet td.gutter.checked .ohne-sheet-tick {
    display: inline-grid;
  }

  .ohne-sheet.has-checks td.gutter .ohne-sheet-rownum,
  .ohne-sheet tbody tr:hover td.gutter .ohne-sheet-rownum,
  .ohne-sheet td.gutter.checked .ohne-sheet-rownum {
    display: none;
  }

  .ohne-sheet-tick {
    display: inline-grid;
    place-items: center;
    width: 13px;
    height: 13px;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    color: var(--accent-ink);
    font-size: 8px;
    line-height: 1;
    vertical-align: middle;
    transition:
      background var(--pace),
      border-color var(--pace);
  }

  .ohne-sheet-tick.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .ohne-sheet-open {
    flex: none;
    width: 28px;
    height: var(--row);
    display: grid;
    place-items: center;
    color: var(--dim);
    opacity: 0;
    transition: opacity var(--pace);
  }

  .ohne-sheet tbody tr:hover .ohne-sheet-open,
  .ohne-sheet td.gutter.cursor .ohne-sheet-open,
  .ohne-sheet-open:focus-visible {
    opacity: 1;
  }

  .ohne-sheet-state {
    display: grid;
    place-items: center;
    gap: var(--s3);
    padding: var(--s6) var(--s4);
    color: var(--dim);
    text-align: center;
  }

  .ohne-sheet td.skeleton i {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--raised);
  }

  .ohne-sheet-foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s4);
    height: 30px;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: 0 var(--s3);
  }

  .ohne-sheet-hints {
    display: flex;
    gap: var(--s4);
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--faint);
    overflow: hidden;
  }

  .ohne-sheet-hints b {
    color: var(--dim);
    font-weight: 400;
  }

  .ohne-sheet-pager {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .ohne-sheet-pageinfo {
    color: var(--faint);
    font-family: var(--mono);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * The headless sheet, rendered: a sticky-headed grid with a cell cursor, row checks, and keys.
 * The data source stays behind `SheetModel`; the sheet owns the cursor, checks, editing, and paging.
 * Click selects, Shift-click stretches, arrows move, PageUp and PageDown step pages.
 * The gutter tick checks a row for bulk actions; the cursor never feeds row picking.
 * Double-click or Enter opens the cell's inline editor when the model provides one.
 * A cell that cannot edit in place falls through to the model's `open`, as does `mod+Enter`.
 * Pass a `selection` to share the cursor with surrounding chrome.
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

  // The editing address is page-relative, so an editor left open across a reload, sort, or search
  // would respawn over whichever record now sits at that address and steal focus into it.
  let seenPage = untracked(() => model.page());
  effect(() => {
    const current = model.page();
    if (current === seenPage) return;
    seenPage = current;
    closeEditor(null);
  });

  const openEditor = (cell: CellAddress): void => {
    const current = model.page();
    const rowValue = current?.records[cell.row];
    const column = model.columns()[cell.column];
    if (isUndefined(rowValue) || isUndefined(column)) return;
    const editable = !isUndefined(model.editor) && model.canEdit?.(rowValue, column) !== false;
    if (!editable) {
      model.open?.(rowValue, column);
      return;
    }
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
    model.checks?.clear();
    model.setPage(next);
  };

  const pageKeys = (): string[] =>
    (model.page()?.records ?? []).map((row, index) => model.rowKey(row, index));

  const allChecked = (): boolean => {
    const checks = model.checks;
    if (isUndefined(checks)) return false;
    const keys = pageKeys();
    return keys.length > 0 && keys.every((key) => checks.has(key));
  };

  const match = sheetKeymap({
    move: (dx, dy, extend) => owned.move(dx, dy, extend),
    checkAll: () => model.checks?.setAll(pageKeys()),
    check: () => {
      const checks = model.checks;
      const focus = owned.focus();
      if (isUndefined(checks) || isNull(focus)) return;
      const keys = pageKeys();
      const key = keys[focus.row];
      if (!isUndefined(key)) checks.toggle(key, focus.row, keys);
    },
    open: () => {
      const focus = owned.focus();
      if (isNull(focus)) return;
      const rowValue = model.page()?.records[focus.row];
      if (!isUndefined(rowValue)) model.open?.(rowValue);
    },
    clear: () => {
      const rect = owned.range();
      const focus = owned.focus();
      if (
        !isNull(rect) &&
        !isNull(focus) &&
        (rect.top !== rect.bottom || rect.left !== rect.right)
      ) {
        owned.set(focus);
        return;
      }
      if ((model.checks?.count() ?? 0) > 0) {
        model.checks?.clear();
        return;
      }
      owned.clear();
    },
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
    if (!isNull(editing.value)) return;
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
    if (onGutterClick(event)) return;
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

  const columnCount = (): number => model.columns().length;

  const tick = (on: () => boolean, label?: () => string): Child =>
    h(
      'span',
      {
        class: () => `ohne-sheet-tick${on() ? ' on' : ''}`,
        role: isUndefined(label) ? null : 'checkbox',
        'aria-checked': isUndefined(label) ? null : () => (on() ? 'true' : 'false'),
        'aria-label': label,
      },
      () => (on() ? '✓' : ''),
    );

  const onGutterClick = (event: MouseEvent): boolean => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const cell = target.closest('td[data-gutter]');
    if (isNull(cell)) return false;
    const checks = model.checks;
    if (isUndefined(checks)) return true;
    const index = Number(cell.getAttribute('data-gutter'));
    const keys = pageKeys();
    const key = keys[index];
    if (!isUndefined(key)) checks.toggle(key, index, keys, event.shiftKey);
    return true;
  };

  const gutterClass = (checked: boolean, index: number): string => {
    let classes = 'gutter';
    if (checked) classes += ' checked';
    if (checked && model.dangerRows?.() === true) classes += ' armed';
    if (owned.focus()?.row === index) classes += ' cursor';
    return classes;
  };

  const openAnchor = (row: () => TRow): Child => {
    if (isUndefined(model.rowHref)) return null;
    return () => {
      const href = model.rowHref?.(row());
      if (isUndefined(href)) return null;
      return h(
        'a',
        { class: 'ohne-sheet-open', href, 'aria-label': () => model.openLabel?.() ?? 'open' },
        icon('maximize'),
      );
    };
  };

  const headerCell = (column: () => SheetColumn): Child => {
    const sortable = (): boolean =>
      !isUndefined(model.toggleSort) && model.sortable?.(column()) === true;
    const active = (): { key: string; desc: boolean } | undefined => {
      const current = model.sort?.();
      return current?.key === column().key ? current : undefined;
    };
    return h(
      'th',
      {
        class: () => {
          const align = alignClass(column());
          const classes = `${align === false ? '' : align}${sortable() ? ' sortable' : ''}`.trim();
          return classes === '' ? false : classes;
        },
        style: () => widthStyle(column()),
        'aria-sort': () => {
          const current = active();
          if (isUndefined(current)) return false;
          return current.desc ? 'descending' : 'ascending';
        },
        onClick: () => {
          if (sortable()) model.toggleSort?.(column().key);
        },
      },
      () => column().label,
      h('span', { class: 'ohne-sheet-sort' }, () => {
        const current = active();
        if (isUndefined(current)) return '';
        return current.desc ? '▾' : '▴';
      }),
    );
  };

  container = h(
    'div',
    {
      class: () => `ohne-sheet${(model.checks?.count() ?? 0) > 0 ? ' has-checks' : ''}`,
      tabindex: '0',
      onKeydown,
    },
    h(
      'div',
      { class: 'ohne-sheet-scroll' },
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h(
              'th',
              {
                class: 'gutter',
                onClick: () => {
                  const checks = model.checks;
                  if (isUndefined(checks)) return;
                  if (allChecked()) checks.clear();
                  else checks.setAll(pageKeys());
                },
              },
              h(
                'div',
                { class: 'ohne-sheet-gutter' },
                h(
                  'span',
                  { class: 'ohne-sheet-gutter-check' },
                  isUndefined(model.checks) ? null : tick(allChecked),
                ),
              ),
            ),
            each(
              () => model.columns(),
              (column) => column.key,
              headerCell,
            ),
          ),
        ),
        h(
          'tbody',
          { onClick: onCellClick, onDblClick: onCellDblClick },
          when(
            () => isUndefined(model.page()),
            () =>
              when(
                () => model.failed?.() === true,
                () => stateRow(columnCount, () => model.failure?.()),
                () => skeleton(columnCount),
              ),
            () =>
              when(
                () => (model.page()?.records.length ?? 0) === 0,
                () => stateRow(columnCount, () => model.empty?.()),
                () =>
                  each(
                    () => model.page()?.records ?? [],
                    (row, index) => model.rowKey(row, index),
                    (row, index) => {
                      const checked = (): boolean =>
                        model.checks?.has(model.rowKey(row(), index())) === true;
                      return h(
                        'tr',
                        null,
                        h(
                          'td',
                          {
                            class: () => gutterClass(checked(), index()),
                            'data-gutter': () => String(index()),
                          },
                          h(
                            'div',
                            { class: 'ohne-sheet-gutter' },
                            h(
                              'span',
                              { class: 'ohne-sheet-gutter-check' },
                              h('span', { class: 'ohne-sheet-rownum' }, () => String(index() + 1)),
                              isUndefined(model.checks)
                                ? null
                                : tick(checked, () => `row ${index() + 1}`),
                            ),
                            openAnchor(row),
                          ),
                        ),
                        each(
                          () => model.columns(),
                          (column) => column.key,
                          (column, columnIndex) =>
                            h(
                              'td',
                              {
                                'data-row': () => String(index()),
                                'data-column': () => String(columnIndex()),
                                style: () => widthStyle(column()),
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
                                  const child = untracked(() =>
                                    model.editor?.(row, column(), () => closeEditor(active)),
                                  );
                                  if (!isUndefined(child)) return child;
                                  // A model that refuses this cell would otherwise stay `editing`,
                                  // and the grid swallows every key while it is. Closing here is
                                  // safe: `trigger` skips the running effect, so this pass's own
                                  // display content stands.
                                  closeEditor(active);
                                }
                                return model.cell(row, column());
                              },
                            ),
                        ),
                      );
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
      h(
        'div',
        { class: 'ohne-sheet-hints' },
        each(
          () => model.hints?.() ?? [],
          (hint) => hint.keys,
          (hint) =>
            h(
              'span',
              null,
              h('b', null, () => hint().keys),
              ' ',
              () => hint().label,
            ),
        ),
      ),
      h(
        'div',
        { class: 'ohne-sheet-pager' },
        button('‹', {
          variant: 'ghost',
          onClick: () => step(-1),
          disabled: () => (model.page()?.page ?? 1) <= 1,
        }),
        h('span', { class: 'ohne-sheet-pageinfo' }, () => {
          const current = model.page();
          if (isUndefined(current)) return '';
          const from = current.total === 0 ? 0 : (current.page - 1) * current.perPage + 1;
          const to = Math.min(current.page * current.perPage, current.total);
          return `${from}-${to} · ${current.page}/${current.lastPage}`;
        }),
        button('›', {
          variant: 'ghost',
          onClick: () => step(1),
          disabled: () => {
            const current = model.page();
            return isUndefined(current) || current.page >= current.lastPage;
          },
        }),
      ),
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
  let classes = column.numeric ? 'numeric' : column.center ? 'center' : '';
  if (selection.isSelected(rowIndex, columnIndex)) classes += ' selected';
  if (selection.isFocus(rowIndex, columnIndex)) classes += ' focused';
  if (!isNull(editing) && editing.row === rowIndex && editing.column === columnIndex) {
    classes += ' editing';
  }
  if (model.invalid?.(row, column) === true) classes += ' invalid';
  return classes;
}

/**
 * The header cell's alignment class, mirroring the body's.
 */
function alignClass(column: SheetColumn): string | false {
  if (column.numeric) return 'numeric';
  if (column.center) return 'center';
  return false;
}

/**
 * The fixed-width style for a sized column; unsized columns share the remaining room.
 */
function widthStyle(column: SheetColumn): string | false {
  if (isUndefined(column.width)) return false;
  return `width:${column.width}px;min-width:${column.width}px;max-width:${column.width}px`;
}

/**
 * One full-width grid row carrying a centered state block, for the empty and failed states.
 */
function stateRow(columns: () => number, content: () => Child): Child {
  return h(
    'tr',
    null,
    h(
      'td',
      { colspan: () => String(columns() + 1), class: 'state' },
      h('div', { class: 'ohne-sheet-state' }, content),
    ),
  );
}

/**
 * The placeholder rows the sheet shows while its first page loads.
 * Bar widths cycle so the block reads as data rather than as a progress meter.
 */
function skeleton(columns: () => number): Child {
  const widths = ['62%', '44%', '78%', '52%', '70%'];
  return Array.from({ length: 8 }, (_, row) =>
    h(
      'tr',
      null,
      h('td', { class: 'gutter' }),
      Array.from({ length: Math.max(1, columns()) }, (_, column) =>
        h(
          'td',
          { class: 'skeleton' },
          h('i', { style: `width:${widths[(row + column) % widths.length]}` }),
        ),
      ),
    ),
  );
}
