import type { SQLValue } from '../../database/adapter.ts';
import type { QueryIR } from '../ir.ts';
import type { SelectedColumn } from '../sql/select.ts';

import { isNull } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { queryMetadata } from '../metadata.ts';
import { compileLimit, compileOrder } from '../sql/order.ts';
import { compileSelect } from '../sql/select.ts';
import { compileWhere } from '../sql/where.ts';
import { assertBoundParams } from '../wire/limits.ts';

/**
 * One assembled record: field names mapped to their deserialized values.
 */
export type QueryRecord = Record<string, unknown>;

/**
 * Reads and assembles every row a snapshot selects, in field-declaration order.
 *
 * The projection, condition, order, and window compile against the ambient connection and dialect.
 * Each driver value crosses back through `dialect.deserialize`, keyed by its column's logical type.
 * The `UUID` tiebreaker keeps the order total, so repeated reads and pagination stay stable.
 */
export async function readRows(ir: QueryIR): Promise<QueryRecord[]> {
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const { sql: head, output } = compileSelect(ir, meta, dialect);
  const parts = [head];
  const params: SQLValue[] = [];
  if (!isNull(ir.condition)) {
    const where = compileWhere(ir.condition, meta, dialect);
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  parts.push(`ORDER BY ${compileOrder(ir, meta, dialect)}`);
  const limit = compileLimit(ir);
  if (limit.sql !== '') {
    parts.push(limit.sql);
    params.push(...limit.params);
  }
  assertBoundParams(params.length);
  const rows = await useDatabase().query<Record<string, SQLValue>>(parts.join(' '), params);
  return rows.map((row) => assembleRecord(row, output, dialect));
}

/**
 * Deserializes one driver row into a record, one column at a time through the dialect codec.
 */
function assembleRecord(
  row: Record<string, SQLValue>,
  output: readonly SelectedColumn[],
  dialect: ReturnType<typeof useDialect>,
): QueryRecord {
  const record: QueryRecord = {};
  for (const column of output) {
    record[column.name] = dialect.deserialize(column.logicalType, row[column.column]);
  }
  return record;
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
