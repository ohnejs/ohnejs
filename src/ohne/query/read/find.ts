import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { SQLFragment } from '../sql/fragment.ts';

import { isNull } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { compileLimit, compileOrder } from '../sql/order.ts';
import { compileSelect } from '../sql/select.ts';
import { compileWhere } from '../sql/where.ts';
import { assertBoundParams } from '../wire/guards.ts';
import { hydrateScope } from './hydrate.ts';
import { applyPopulate } from './loaders/populate.ts';

/**
 * One assembled record: field names mapped to their deserialized values.
 */
export type QueryRecord = Record<string, unknown>;

/**
 * Compiles the tail every read shares: the optional `WHERE`, the total `ORDER BY`, and the row window.
 *
 * The condition, order keys, and limit/offset compile against the collection's metadata and dialect.
 * The `UUID` tiebreaker keeps the order total, so repeated reads and pagination stay stable.
 * The head - the projection - varies per read, so the caller prepends it to this fragment.
 */
export function compileReadTail(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  const parts: string[] = [];
  const params: SQLValue[] = [];
  if (!isNull(ir.condition)) {
    const where = compileWhere(ir.condition, meta, dialect, locale);
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  parts.push(`ORDER BY ${compileOrder(ir, meta, dialect)}`);
  const limit = compileLimit(ir);
  if (limit.sql !== '') {
    parts.push(limit.sql);
    params.push(...limit.params);
  }
  return { sql: parts.join(' '), params };
}

/**
 * Reads and assembles every row a snapshot selects, hydrating and populating its column-less fields.
 *
 * The projection, condition, order, and window compile against the ambient connection and dialect.
 * Column values cross back through `dialect.deserialize`.
 * `records` relations and composites hydrate over the rowset in batched loader reads.
 * Populated relations then swap their `UUID`s for full records.
 */
export async function readRows(ir: QueryIR): Promise<QueryRecord[]> {
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const locale = effectiveLocale(ir.locale);
  const head = compileSelect(ir, meta, dialect, locale);
  const tail = compileReadTail(ir, meta, dialect, locale);
  assertBoundParams(head.params.length + tail.params.length, dialect.maxParameters);
  const rows = await useDatabase().query<Record<string, SQLValue>>(`${head.sql} ${tail.sql}`, [
    ...head.params,
    ...tail.params,
  ]);
  const records = await hydrateScope(meta.fields, rows, ir.select, dialect, locale);
  await applyPopulate(ir, meta, records, dialect);
  return records;
}

/**
 * Reads every matching record.
 */
export function findMany(ir: QueryIR): Promise<QueryRecord[]> {
  return readRows(ir);
}

/**
 * Reads the first matching record, or `undefined` when none match; the read caps at one row.
 */
export async function findFirst(ir: QueryIR): Promise<QueryRecord | undefined> {
  const rows = await readRows({ ...ir, limit: 1 });
  return rows[0];
}
