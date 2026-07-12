import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { isNull } from '../../../utils/index.ts';
import { rawFragment, type SQLFragment } from './fragment.ts';

/**
 * Compiles the `ORDER BY` body, always ending on the `UUID` tiebreaker for a stable total order.
 *
 * Sort keys render in priority order; a field repeated across `orderBy` calls keeps its first direction.
 * `UUID` is appended ascending unless a key already orders it, so equal sort keys never shuffle.
 * SQLite's native NULL placement matches the pinned contract: NULLs first ascending, last descending.
 */
export function compileOrder(ir: QueryIR, meta: CollectionQueryMeta, dialect: Dialect): string {
  const seen = new Set<string>();
  const clauses: string[] = [];
  for (const entry of ir.order) {
    if (seen.has(entry.field)) continue;
    seen.add(entry.field);
    const column = meta.fields[entry.field].column as string;
    clauses.push(`${dialect.quote(column)} ${entry.direction === 'desc' ? 'DESC' : 'ASC'}`);
  }
  if (!seen.has('UUID')) clauses.push(`${dialect.quote('UUID')} ASC`);
  return clauses.join(', ');
}

/**
 * Compiles the `LIMIT`/`OFFSET` tail, or an empty fragment when neither is set.
 * An offset without a limit compiles `LIMIT -1 OFFSET ?`, SQLite's idiom for "all rows past the offset".
 */
export function compileLimit(ir: QueryIR): SQLFragment {
  if (isNull(ir.limit) && isNull(ir.offset)) return rawFragment('');
  if (isNull(ir.offset)) return rawFragment('LIMIT ?', [ir.limit as SQLValue]);
  return rawFragment('LIMIT ? OFFSET ?', [ir.limit ?? -1, ir.offset]);
}
