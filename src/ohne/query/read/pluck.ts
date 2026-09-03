import type { SQLValue } from '../../database/adapter.ts';
import type { QueryIR } from '../ir.ts';

import { isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { readCondition } from '../ir.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { assertBoundParams } from '../sql/fragment.ts';
import { compileFrom } from '../sql/from.ts';
import { compileReadTail, readRows } from './find.ts';
import { deserializeColumn } from './hydrate.ts';
import { resolveIR } from './resolve-ir.ts';

/**
 * Reads one field's value from every matching record, in the query's order.
 *
 * A plain column or unpopulated `record` foreign key fast-paths to a one-column `SELECT`.
 * Its values cross back through the dialect codec and the field type's `deserialize` hook.
 * They return exactly as a row read's values would.
 * A `records` relation, a composite, or a populated relation falls back to the read path.
 * The fallback narrows the read to that one field and takes its value from each assembled record.
 * The order and window match `findMany`, so a `pluck` reads the same rows the row read would.
 */
export async function pluck(ir: QueryIR, field: string): Promise<unknown[]> {
  const meta = queryMetadata(ir.collection);
  const entry = meta.fields[field];
  if (isUndefined(entry.column) || ir.populate.some((node) => node.field === field)) {
    const rows = await readRows({ ...ir, select: [field] });
    return rows.map((row) => row[field]);
  }
  ir = await resolveIR(ir);
  const dialect = useDialect();
  const locale = effectiveLocale(ir.locale);
  const tail = compileReadTail(ir, meta, dialect, locale);
  const from = compileFrom(
    meta,
    { fields: [field], condition: readCondition(ir), order: ir.order },
    locale,
    dialect,
  );
  assertBoundParams(from.params.length + tail.params.length, dialect.maxParameters);
  const head = `SELECT ${dialect.quote(entry.column)} AS "value" ${from.sql}`;
  const rows = await useDatabase().query<{ value: SQLValue }>(`${head} ${tail.sql}`, [
    ...from.params,
    ...tail.params,
  ]);
  return Promise.all(rows.map((row) => deserializeColumn(field, entry, dialect, row.value)));
}
