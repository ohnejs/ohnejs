import { isString } from 'ohnejs/utils';

/**
 * The slice of a table row the selection reads.
 * A structural subset, so this module stays free of the browser-only dashboard types.
 */
export interface SelectionRow {
  /**
   * The record's `UUID`, which keys its row; a row without one keys by its page index and never selects.
   */
  UUID?: unknown;
}

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
export function admitsRow(verdict: ReadonlySet<string>, id: unknown): boolean {
  return isString(id) && verdict.has(id);
}

/**
 * The page's rows the `deletable` verdict admits, in page order.
 * The selection feeds the batch delete, so these are the rows that select.
 *
 * @example
 * ```ts
 * deletableRows([{ UUID: 'a' }, { UUID: 'b' }], new Set(['b'])) // -> [{ UUID: 'b' }]
 * ```
 */
export function deletableRows<R extends SelectionRow>(
  rows: readonly R[],
  deletable: ReadonlySet<string>,
): R[] {
  return rows.filter((row) => admitsRow(deletable, row.UUID));
}

/**
 * The selection without the rows the `deletable` verdict refuses, in selection order.
 *
 * @example
 * ```ts
 * deletableSelection(new Set(['a', 'b']), new Set(['b'])) // -> Set { 'b' }
 * ```
 */
export function deletableSelection(
  selected: ReadonlySet<number | string>,
  deletable: ReadonlySet<string>,
): Set<string> {
  return new Set([...selected].filter((id): id is string => admitsRow(deletable, id)));
}

/**
 * The header checkbox state over the page's deletable rows.
 * It stays `false` until each of them is selected, so a page without one never checks.
 * A full page reads `true` when nothing deletable lies beyond the selection: `allSelected`, or a lone page.
 * Otherwise it reads `'indeterminate'`.
 *
 * @example
 * ```ts
 * selectAllStateOf([{ UUID: 'a' }], new Set(['a']), false, 1) // -> true
 * selectAllStateOf([{ UUID: 'a' }], new Set(['a']), false, 3) // -> 'indeterminate'
 * selectAllStateOf([{ UUID: 'a' }], new Set(['a']), true, 3)  // -> true
 * selectAllStateOf([{ UUID: 'a' }], new Set(), true, 3)       // -> false
 * ```
 */
export function selectAllStateOf(
  rows: readonly SelectionRow[],
  selected: ReadonlySet<unknown>,
  allSelected: boolean,
  lastPage: number,
): boolean | 'indeterminate' {
  if (rows.length === 0 || !rows.every((row) => selected.has(row.UUID))) return false;
  return allSelected || lastPage === 1 ? true : 'indeterminate';
}

/**
 * How many rows the selection covers.
 * While every page is selected that is `allCount`, the deletable rows across the pages.
 *
 * @example
 * ```ts
 * selectedCountOf(new Set(['a']), false, 120) // -> 1
 * selectedCountOf(new Set(['a']), true, 120)  // -> 120
 * ```
 */
export function selectedCountOf(
  selected: ReadonlySet<unknown>,
  allSelected: boolean,
  allCount: number,
): number {
  return allSelected ? allCount : selected.size;
}
