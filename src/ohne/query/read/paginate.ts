import type { QueryIR } from '../ir.ts';
import type { QueryRecord } from './find.ts';

import { count } from './count.ts';
import { readRows } from './find.ts';

/**
 * One page of results, with the totals a pager needs to render its controls.
 */
export interface PaginatedResult {
  /**
   * The records on this page, in the query's order.
   */
  records: QueryRecord[];

  /**
   * The total number of matching records across every page.
   */
  total: number;

  /**
   * The page just read, one-based.
   */
  page: number;

  /**
   * The page size this read used.
   */
  perPage: number;

  /**
   * The index of the last page, at least `1`.
   */
  lastPage: number;
}

/**
 * Reads one page, composing the count and the row read from a single frozen snapshot.
 *
 * The count resolves first; a page past the last one short-circuits to empty, issuing no row read.
 * Page one always reads its rows, so an empty collection returns an empty page, not a skipped read.
 */
export async function paginate(
  ir: QueryIR,
  page: number,
  perPage: number,
): Promise<PaginatedResult> {
  const total = await count(ir);
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  if (page > lastPage) return { records: [], total, page, perPage, lastPage };
  const records = await readRows({ ...ir, limit: perPage, offset: (page - 1) * perPage });
  return { records, total, page, perPage, lastPage };
}
