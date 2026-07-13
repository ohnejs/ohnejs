import type { SQLValue } from '../../database/adapter.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';

import { isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { queryMetadata } from '../metadata.ts';
import { assertBoundParams } from '../wire/limits.ts';
import { compileReadTail, readRows } from './find.ts';

/**
 * Reads one field's value from every matching record, in the query's order.
 *
 * A plain column or unpopulated `record` foreign key fast-paths to a one-column `SELECT`.
 * Its values cross back through the dialect codec.
 * A `records` relation, a composite, or a populated relation falls back to the read path.
 * The fallback narrows the read to that one field and takes its value from each assembled record.
 * The order and window match `findMany`, so a `pluck` reads the same rows the row read would.
 */
export async function pluck(ir: QueryIR, field: string): Promise<unknown[]> {
  const meta = queryMetadata(ir.collection);
  const entry = meta.fields[field];
  if (isUndefined(entry.column) || ir.populate.includes(field)) {
    const rows = await readRows({ ...ir, select: [field] });
    return rows.map((row) => row[field]);
  }
  const dialect = useDialect();
  const tail = compileReadTail(ir, meta, dialect);
  assertBoundParams(tail.params.length);
  const head = `SELECT ${dialect.quote(entry.column)} AS "value" FROM ${dialect.quote(meta.table)}`;
  const rows = await useDatabase().query<{ value: SQLValue }>(`${head} ${tail.sql}`, tail.params);
  return rows.map((row) => dialect.deserialize(entry.logicalType as LogicalType, row.value));
}
