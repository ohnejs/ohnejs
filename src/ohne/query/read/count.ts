import type { SQLValue } from '../../database/adapter.ts';
import type { QueryIR } from '../ir.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { queryMetadata } from '../metadata.ts';
import { compileWhere } from '../sql/where.ts';
import { assertBoundParams } from '../wire/guards.ts';

/**
 * Counts every matching row, ignoring order and the row window, which a count never applies.
 */
export async function count(ir: QueryIR): Promise<number> {
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const parts = [`SELECT COUNT(*) AS "count" FROM ${dialect.quote(meta.table)}`];
  const params: SQLValue[] = [];
  if (!isNull(ir.condition)) {
    const where = compileWhere(ir.condition, meta, dialect);
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  assertBoundParams(params.length, dialect.maxParameters);
  const row = await useDatabase().queryOne<{ count: number }>(parts.join(' '), params);
  return Number(row?.count ?? 0);
}

/**
 * Whether any row matches, short-circuiting at the first one rather than counting the set.
 */
export async function exists(ir: QueryIR): Promise<boolean> {
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const parts = [`SELECT 1 FROM ${dialect.quote(meta.table)}`];
  const params: SQLValue[] = [];
  if (!isNull(ir.condition)) {
    const where = compileWhere(ir.condition, meta, dialect);
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  parts.push('LIMIT 1');
  assertBoundParams(params.length, dialect.maxParameters);
  const row = await useDatabase().queryOne<{ 1: number }>(parts.join(' '), params);
  return !isUndefined(row);
}
