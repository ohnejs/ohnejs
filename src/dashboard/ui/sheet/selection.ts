import { isNull } from '../../../utils/is/is-null.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { ref } from '../../../utils/reactive/ref.ts';

/**
 * One cell position in the sheet's visible page, zero-based.
 */
export interface CellAddress {
  /**
   * The row index within the page.
   */
  row: number;

  /**
   * The column index.
   */
  column: number;
}

/**
 * The normalized rectangle between the selection's anchor and focus, inclusive.
 */
export interface CellRange {
  /**
   * The first selected row.
   */
  top: number;

  /**
   * The first selected column.
   */
  left: number;

  /**
   * The last selected row.
   */
  bottom: number;

  /**
   * The last selected column.
   */
  right: number;
}

/**
 * The sheet's selection: one rectangular range spanned between an anchor and a focus cell.
 * Every read is reactive; every write moves the rectangle.
 */
export interface SheetSelection {
  /**
   * The cell the selection grows from; `null` when nothing is selected.
   */
  anchor(): CellAddress | null;

  /**
   * The cell the keyboard moves; `null` when nothing is selected.
   */
  focus(): CellAddress | null;

  /**
   * The selected rectangle; `null` when nothing is selected.
   */
  range(): CellRange | null;

  /**
   * Whether the cell lies inside the selected rectangle.
   */
  isSelected(row: number, column: number): boolean;

  /**
   * Whether the cell is the focus cell.
   */
  isFocus(row: number, column: number): boolean;

  /**
   * Collapses the selection to one cell.
   */
  set(cell: CellAddress): void;

  /**
   * Stretches the rectangle from the anchor to `cell`; with no anchor it collapses to `cell`.
   */
  extend(cell: CellAddress): void;

  /**
   * Moves the focus by a delta, clamped to the grid; `extend` stretches instead of collapsing.
   * An infinite delta jumps to the grid's edge.
   * With nothing selected the first move lands on the first cell.
   */
  move(dx: number, dy: number, extend: boolean): void;

  /**
   * Selects the whole grid.
   */
  selectAll(): void;

  /**
   * Selects one full row; `extend` stretches the rectangle's rows to it instead.
   */
  selectRow(row: number, extend?: boolean): void;

  /**
   * Deselects everything.
   */
  clear(): void;
}

/**
 * Creates a sheet selection over a grid whose size `size` reports reactively.
 * The model is DOM-free; the sheet component binds it to cells and keys.
 *
 * @example
 * ```ts
 * const selection = createSheetSelection(() => ({ rows: 20, columns: 5 }))
 * selection.set({ row: 1, column: 1 })
 * selection.move(0, 1, true)
 * selection.range() // -> { top: 1, left: 1, bottom: 2, right: 1 }
 * ```
 */
export function createSheetSelection(
  size: () => { rows: number; columns: number },
): SheetSelection {
  const anchor = ref<CellAddress | null>(null);
  const focus = ref<CellAddress | null>(null);

  const range = computed<CellRange | null>(() => {
    const from = anchor.value;
    const to = focus.value;
    if (isNull(from) || isNull(to)) return null;
    return {
      top: Math.min(from.row, to.row),
      left: Math.min(from.column, to.column),
      bottom: Math.max(from.row, to.row),
      right: Math.max(from.column, to.column),
    };
  });

  const clamped = (cell: CellAddress): CellAddress => {
    const { rows, columns } = size();
    return {
      row: clamp(cell.row, 0, Math.max(0, rows - 1)),
      column: clamp(cell.column, 0, Math.max(0, columns - 1)),
    };
  };

  const set = (cell: CellAddress): void => {
    const next = clamped(cell);
    anchor.value = next;
    focus.value = next;
  };

  return {
    anchor: () => anchor.value,
    focus: () => focus.value,
    range: () => range.value,
    isSelected(row, column) {
      const rect = range.value;
      if (isNull(rect)) return false;
      return row >= rect.top && row <= rect.bottom && column >= rect.left && column <= rect.right;
    },
    isFocus(row, column) {
      const cell = focus.value;
      return !isNull(cell) && cell.row === row && cell.column === column;
    },
    set,
    extend(cell) {
      if (isNull(anchor.value)) {
        set(cell);
        return;
      }
      focus.value = clamped(cell);
    },
    move(dx, dy, extend) {
      const base = focus.value;
      if (isNull(base)) {
        set({ row: 0, column: 0 });
        return;
      }
      const next = clamped({ row: base.row + dy, column: base.column + dx });
      if (extend) {
        focus.value = next;
        return;
      }
      set(next);
    },
    selectAll() {
      const { rows, columns } = size();
      if (rows === 0 || columns === 0) return;
      anchor.value = { row: 0, column: 0 };
      focus.value = { row: rows - 1, column: columns - 1 };
    },
    selectRow(row, extend = false) {
      const { rows, columns } = size();
      if (rows === 0 || columns === 0) return;
      const target = clamp(row, 0, rows - 1);
      const from = anchor.value;
      anchor.value = { row: extend && !isNull(from) ? from.row : target, column: 0 };
      focus.value = { row: target, column: columns - 1 };
    },
    clear() {
      anchor.value = null;
      focus.value = null;
    },
  };
}
