import { isString, pick } from 'ohnejs/utils';

/**
 * The slice of a table row the selection reads.
 * A structural subset, so this module stays free of the browser-only dashboard types.
 */
export interface SelectionRow {
  /**
   * The row id: the record's `UUID`, or its page index when the record carries none.
   */
  id: number | string;
}

/**
 * The table's selection map, from row id to selection state.
 */
export type TableSelection = Readonly<Record<number | string, boolean>>;

/**
 * The `UUID`s a page of records carries, in page order: the rows a surface asks verdicts about.
 *
 * @example
 * ```ts
 * pageUUIDs([{ UUID: 'a', title: 'One' }, { title: 'Two' }]) // -> ['a']
 * ```
 */
export function pageUUIDs(records: readonly Record<string, unknown>[]): string[] {
  return records.map((record) => record.UUID).filter(isString);
}

/**
 * Whether a verdict names the row.
 * A verdict holds `UUID`s alone, so a row identified by its page index is never admitted.
 *
 * @example
 * ```ts
 * admitsRow(new Set(['a']), 'a') // -> true
 * admitsRow(new Set(['a']), 'b') // -> false
 * admitsRow(new Set(['0']), 0)   // -> false
 * ```
 */
export function admitsRow(verdict: ReadonlySet<string>, id: number | string): boolean {
  return isString(id) && verdict.has(id);
}

/**
 * The page's rows the `deletable` verdict admits, in page order.
 * The selection feeds the batch delete, so these are the rows that select.
 *
 * @example
 * ```ts
 * deletableRows([{ id: 'a' }, { id: 'b' }], new Set(['b'])) // -> [{ id: 'b' }]
 * ```
 */
export function deletableRows<R extends SelectionRow>(
  rows: readonly R[],
  deletable: ReadonlySet<string>,
): R[] {
  return rows.filter((row) => admitsRow(deletable, row.id));
}

/**
 * The selection without the rows the `deletable` verdict refuses.
 *
 * @example
 * ```ts
 * deletableSelection({ a: true, b: true }, new Set(['b'])) // -> { b: true }
 * ```
 */
export function deletableSelection(
  selected: TableSelection,
  deletable: ReadonlySet<string>,
): Record<string, boolean> {
  return pick(selected, [...deletable]);
}

/**
 * The header checkbox state over the page's deletable rows.
 * It stays `false` until each of them is selected, so a page without one never checks.
 * A full page reads `true` when nothing deletable lies beyond the selection: `allSelected`, or a lone page.
 * Otherwise it reads `'indeterminate'`.
 *
 * @example
 * ```ts
 * selectAllStateOf([{ id: 'a' }], { a: true }, false, 1) // -> true
 * selectAllStateOf([{ id: 'a' }], { a: true }, false, 3) // -> 'indeterminate'
 * selectAllStateOf([{ id: 'a' }], { a: true }, true, 3)  // -> true
 * selectAllStateOf([{ id: 'a' }], {}, true, 3)           // -> false
 * ```
 */
export function selectAllStateOf(
  rows: readonly SelectionRow[],
  selected: TableSelection,
  allSelected: boolean,
  lastPage: number,
): boolean | 'indeterminate' {
  if (rows.length === 0 || !rows.every((row) => selected[row.id] === true)) return false;
  return allSelected || lastPage === 1 ? true : 'indeterminate';
}

/**
 * How many rows the selection covers.
 * While every page is selected that is `allCount`, the deletable rows across the pages.
 *
 * @example
 * ```ts
 * selectedCountOf({ a: true, b: false }, false, 120) // -> 1
 * selectedCountOf({ a: true, b: false }, true, 120)  // -> 120
 * ```
 */
export function selectedCountOf(
  selected: TableSelection,
  allSelected: boolean,
  allCount: number,
): number {
  return allSelected ? allCount : Object.values(selected).filter(Boolean).length;
}
