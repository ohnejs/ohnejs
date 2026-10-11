import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';

import { isNullish } from '../../utils/is/is-nullish.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { naturalCompare } from '../../utils/sort/natural-compare.ts';

/**
 * One column of a `table`, typed by the row it reads.
 */
export interface TableColumn<T> {
  /**
   * The header text.
   * Omitted leaves the header empty, as a column of buttons wants.
   */
  label?: Text;

  /**
   * The row's value in this column: the sort key, and the cell text when there is no `render`.
   * Numbers show in the dashboard language with tabular digits; `null` and `undefined` show nothing.
   */
  value?: (row: T) => string | number | null | undefined;

  /**
   * The cell content, in place of the `value` text.
   * It re-runs when the row changes or when anything it reads changes.
   */
  render?: (row: T) => Child;

  /**
   * Whether the header sorts the rows; `'text'` and `'numeric'` pick the matching sort icon.
   * A client-sorted column needs a `value` to sort by, or the header offers no sort.
   *
   * @default
   * false
   */
  sortable?: boolean | 'text' | 'numeric';

  /**
   * Which side the header and the cells align to.
   *
   * @default
   * 'start'
   */
  align?: 'start' | 'end';

  /**
   * A tooltip on the header that explains the column.
   */
  help?: Text;

  /**
   * Lets the cells wrap onto more lines, at least `minWidth` wide.
   * Without it, an auto-layout cell stays on one line.
   *
   * @default
   * false
   */
  wrap?: boolean;

  /**
   * The column width as a CSS length, like `8rem` or `30%`.
   */
  width?: string;

  /**
   * The narrowest the column gets, as a CSS length.
   * A wrapping column falls back to `16rem`.
   */
  minWidth?: string;
}

/**
 * The column a `table` sorts by, and which way.
 */
export interface TableSort<C extends string = string> {
  /**
   * The key of the sorted column in `columns`.
   */
  column: C;

  /**
   * The sort direction.
   */
  direction: 'asc' | 'desc';
}

/**
 * The row selection of a `table`: checkboxes, shift ranges, and the select-all box.
 */
export interface TableSelection<T, K> {
  /**
   * The selected row keys, two-way.
   * Every write is a new `Set`: kept keys keep their place, and new keys append in row order.
   * Keys of rows that are not shown are never dropped, so a selection survives paging.
   */
  selected: Ref<ReadonlySet<K>>;

  /**
   * Whether a row may be selected.
   * A refused row shows a disabled checkbox, and shift ranges and select-all skip it.
   * Omitted admits every row.
   */
  selectable?: (row: T) => boolean;

  /**
   * Whether the checkbox column shows, read reactively.
   * Omitted always shows it.
   */
  checkboxes?: () => boolean;

  /**
   * Replaces the select-all box's state and toggle.
   * Omitted, the box covers the selectable rows of the current page.
   */
  all?: {
    /**
     * The box state, read reactively.
     */
    state: () => boolean | 'indeterminate';

    /**
     * Called with the box's new value when the reader toggles it.
     */
    toggle: (value: boolean) => void | Promise<void>;

    /**
     * A tooltip on the box.
     */
    label?: Text;
  };
}

/**
 * The next sort after a click on a column header.
 * The same column flips its direction; another column starts ascending.
 * There is no third click that clears the sort.
 *
 * @example
 * ```ts
 * toggleSort(null, 'name')                                 // -> { column: 'name', direction: 'asc' }
 * toggleSort({ column: 'name', direction: 'asc' }, 'name') // -> { column: 'name', direction: 'desc' }
 * toggleSort({ column: 'name', direction: 'asc' }, 'id')   // -> { column: 'id', direction: 'asc' }
 * ```
 */
export function toggleSort<C extends string>(sort: TableSort<C> | null, column: C): TableSort<C> {
  return sort?.column === column
    ? { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: 'asc' };
}

/**
 * The selection after a shift-click that ranges from the anchor row to the target row.
 * Every row in the inclusive range takes `value`, except the anchor, which stays selected.
 * A row `selectable` refuses keeps its state.
 * Kept keys keep their place and new keys append in row order.
 * Both keys must belong to `rows`.
 *
 * @example
 * ```ts
 * const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
 * const key = (row: { id: number }) => row.id
 *
 * rangeSelect(rows, key, new Set([3]), 1, 3, true)
 * // -> Set { 3, 1, 2 }
 *
 * rangeSelect(rows, key, new Set([1, 2, 3]), 1, 3, false)
 * // -> Set { 1 }
 *
 * rangeSelect(rows, key, new Set(), 1, 3, true, (row) => row.id !== 2)
 * // -> Set { 1, 3 }
 * ```
 */
export function rangeSelect<T, K>(
  rows: readonly T[],
  key: (row: T, index: number) => K,
  selected: ReadonlySet<K>,
  origin: K,
  target: K,
  value: boolean,
  selectable: (row: T) => boolean = () => true,
): Set<K> {
  const keys = rows.map(key);
  const from = keys.indexOf(origin);
  const to = keys.indexOf(target);
  const next = new Set(selected);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (!selectable(rows[i]!)) continue;
    if (value || keys[i] === origin) next.add(keys[i]!);
    else next.delete(keys[i]!);
  }
  return next;
}

/**
 * A sorted copy of `rows`, by the key `value` reads.
 * Numbers compare as numbers and anything else in natural order, so `'2'` comes before `'11'`.
 * `null`, `undefined`, and `NaN` sort last in both directions, and equal keys keep their order.
 *
 * @example
 * ```ts
 * sortRows([{ n: 'b' }, { n: null }, { n: 'a' }], (row) => row.n, 'asc')
 * // -> [{ n: 'a' }, { n: 'b' }, { n: null }]
 *
 * sortRows([{ n: 2 }, { n: 11 }, { n: NaN }], (row) => row.n, 'desc')
 * // -> [{ n: 11 }, { n: 2 }, { n: NaN }]
 * ```
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | number | null | undefined,
  direction: 'asc' | 'desc',
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const keyed = rows.map((row) => ({ row, key: value(row) }));
  const missing = (key: unknown): boolean => isNullish(key) || Number.isNaN(key);
  keyed.sort((a, b) => {
    if (missing(a.key) || missing(b.key)) return Number(missing(a.key)) - Number(missing(b.key));
    return (
      sign *
      (isNumber(a.key) && isNumber(b.key)
        ? a.key - b.key
        : naturalCompare(String(a.key), String(b.key)))
    );
  });
  return keyed.map(({ row }) => row);
}
