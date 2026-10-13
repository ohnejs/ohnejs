import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { joinFragments, rawFragment, type SQLFragment } from './fragment.ts';
import { localePin } from './where.ts';

/**
 * Compiles the `ORDER BY` body, always ending on the `UUID` tiebreaker for a stable total order.
 *
 * Sort keys render in priority order; a field repeated across `orderBy` calls keeps its first direction.
 * A composite sorts by its sort key's column, read from its child row in the queried locale.
 * `UUID` is appended ascending unless a key already orders it, so equal sort keys never shuffle.
 * SQLite's native NULL placement matches the pinned contract: NULLs first ascending, last descending.
 * A record without the composite's row sorts as NULL.
 */
export function compileOrder(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  const seen = new Set<string>();
  const clauses: SQLFragment[] = [];
  for (const entry of ir.order) {
    if (seen.has(entry.field)) continue;
    seen.add(entry.field);
    const key = sortKey(meta.fields[entry.field]!, meta, dialect, locale, clauses.length);
    const direction = entry.direction === 'desc' ? 'DESC' : 'ASC';
    clauses.push({ sql: `${key.sql} ${direction}`, params: key.params });
  }
  if (!seen.has('UUID')) clauses.push(rawFragment(`${dialect.quote('UUID')} ASC`));
  return joinFragments(clauses, ', ');
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

/**
 * The expression one order key sorts by: a bare column, or a composite's sort-key subquery.
 * The subquery qualifies the outer `UUID`, which its own `FROM` would otherwise capture.
 */
function sortKey(
  field: FieldQueryMeta,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
  index: number,
): SQLFragment {
  if (!isUndefined(field.column)) return rawFragment(dialect.quote(field.column));
  const alias = dialect.quote(`_o${index}`);
  const link = `${alias}.${dialect.quote('_parentUUID')} = ${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const pin = localePin(field, alias, dialect, locale);
  const scope = isNull(pin) ? rawFragment(link) : joinFragments([rawFragment(link), pin], ' AND ');
  const column = `${alias}.${dialect.quote(field.orderBy as string)}`;
  return {
    sql: `(SELECT ${column} FROM ${dialect.quote(field.table as string)} ${alias} WHERE ${scope.sql})`,
    params: scope.params,
  };
}
