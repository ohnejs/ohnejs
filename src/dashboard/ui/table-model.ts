/**
 * One column definition for `table`.
 */
export interface TableColumn<T = unknown> {
  /**
   * The column label.
   * If not provided, the column key is used.
   */
  label?: string;

  /**
   * Controls if the column can be sorted.
   * Accepts a boolean to enable/disable sorting or a string to specify the data type for proper
   * sort icons.
   *
   * @default
   * false
   */
  sortable?: boolean | 'text' | 'numeric';

  /**
   * Sets the width of a table column using CSS values like `100px`, `20rem`, `50%`, `auto`, etc.
   * The specified `width` is applied to the `style` attribute of `<col>` elements within the
   * `<colgroup>`.
   */
  width?: string;

  /**
   * Sets the minimum width of a table column using CSS values like `100px`, `20rem`, etc.
   * The specified `min-width` is applied to the `style` attribute of `<col>` elements within the
   * `<colgroup>`.
   *
   * The `minWidth` property is useful for specifying `width` in percentages while ensuring a
   * minimum width for the column.
   */
  minWidth?: string;

  /**
   * The data type for values in this column.
   *
   * Note: This is a TypeScript type assertion and does not involve any runtime logic or data.
   */
  TType: T;
}

/**
 * The column definitions of a `table`, keyed by column key.
 * Insertion order defines the column order.
 */
export interface TableColumns {
  [key: string]: TableColumn;
}

type InferColumnType<T> = T extends { TType: infer U } ? U : unknown;

/**
 * One data row of a `table`: a unique `id` plus a value per column key.
 */
export type TableRow<T extends TableColumns> = {
  /**
   * A unique identifier for this record.
   */
  id: number | string;
} & Partial<{
  [K in keyof T]: InferColumnType<T[K]>;
}>;

/**
 * The payload a `table` cell renderer receives.
 */
export interface TableCell<T extends TableColumns> {
  /**
   * The row data object containing values for each column.
   */
  row: TableRow<T>;

  /**
   * The zero-based index of the current row in the table data array.
   */
  rowIndex: number;

  /**
   * The column definition object containing configuration like label, width, etc.
   */
  column: TableColumn;

  /**
   * The column key/identifier for the current cell.
   */
  key: string | number;

  /**
   * The zero-based index of the current column in the table.
   */
  columnIndex: number;
}

/**
 * The sorting state of a `table`.
 * When `null`, no sorting is applied.
 */
export type TableSort<TColumns extends TableColumns> = {
  /**
   * The key of the column to sort by.
   */
  column: keyof TColumns;

  /**
   * The direction to sort the column.
   */
  direction: 'asc' | 'desc';
} | null;

/**
 * Helper for creating a column definition for use in the `table` component.
 * An identity cast whose only job is carrying the `TType` value-type inference.
 *
 * @example
 * ```ts
 * const columns = {
 *   id: tableColumn<number>({ label: 'ID', width: '4rem' }),
 *   name: tableColumn<string>({ label: 'Name', minWidth: '8rem' }),
 * }
 * ```
 */
export function tableColumn<T = unknown>(
  definition: Omit<TableColumn<T>, 'TType'>,
): TableColumn<T> {
  return definition as TableColumn<T>;
}

/**
 * The next sorting state after a click on a column's sort button.
 * The same column flips its direction; a different column starts ascending.
 * There is no third click that clears the sort.
 *
 * @example
 * ```ts
 * toggleSort(null, 'name')                                // -> { column: 'name', direction: 'asc' }
 * toggleSort({ column: 'name', direction: 'asc' }, 'name') // -> { column: 'name', direction: 'desc' }
 * toggleSort({ column: 'name', direction: 'asc' }, 'id')   // -> { column: 'id', direction: 'asc' }
 * ```
 */
export function toggleSort<T extends TableColumns>(
  sort: TableSort<T>,
  column: keyof T,
): TableSort<T> {
  return sort && sort.column === column
    ? { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: 'asc' };
}

/**
 * The selection map after a shift-click that ranges from the anchor row to the target row.
 * Every row in the inclusive index range takes `value` on a copy of `selected`; the anchor row is
 * then forced back to `true`, so a deselecting range never drops its own anchor.
 * Both ids must be present in `rows`; the anchor row does not move.
 *
 * @example
 * ```ts
 * rangeSelect([{ id: 1 }, { id: 2 }, { id: 3 }], {}, 1, 3, true)
 * // -> { 1: true, 2: true, 3: true }
 *
 * rangeSelect([{ id: 1 }, { id: 2 }, { id: 3 }], { 1: true, 2: true, 3: true }, 1, 2, false)
 * // -> { 1: true, 2: false, 3: true }
 * ```
 */
export function rangeSelect<T extends TableColumns>(
  rows: readonly TableRow<T>[],
  selected: Record<number | string, boolean>,
  origin: number | string,
  target: number | string,
  value: boolean,
): Record<number | string, boolean> {
  const originIndex = rows.findIndex((row) => row.id === origin);
  const targetIndex = rows.findIndex((row) => row.id === target);
  const [start, end] =
    originIndex < targetIndex ? [originIndex, targetIndex] : [targetIndex, originIndex];
  const next = { ...selected };

  for (let i = start; i <= end; i++) {
    next[rows[i]!.id] = value;
  }

  next[rows[originIndex]!.id] = true;
  return next;
}
