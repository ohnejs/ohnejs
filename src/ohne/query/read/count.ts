import type { SQLValue } from '../../database/adapter.ts';
import type { QueryIR } from '../ir.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { readCondition } from '../ir.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { assertBoundParams } from '../sql/fragment.ts';
import { compileFrom } from '../sql/from.ts';
import { compileReadWhere } from '../sql/where.ts';
import { resolveIR } from './resolve-ir.ts';

/**
 * Counts every matching row, ignoring order and the row window, which a count never applies.
 */
export async function count(ir: QueryIR): Promise<number> {
  ir = await resolveIR(ir);
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const locale = effectiveLocale(ir.locale);
  const from = compileFrom(meta, { condition: readCondition(ir) }, locale, dialect);
  const parts = [`SELECT COUNT(*) AS "count" ${from.sql}`];
  const params: SQLValue[] = [...from.params];
  const where = compileReadWhere(ir, meta, dialect, locale);
  if (!isNull(where)) {
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
  ir = await resolveIR(ir);
  const meta = queryMetadata(ir.collection);
  const dialect = useDialect();
  const locale = effectiveLocale(ir.locale);
  const from = compileFrom(meta, { condition: readCondition(ir) }, locale, dialect);
  const parts = [`SELECT 1 ${from.sql}`];
  const params: SQLValue[] = [...from.params];
  const where = compileReadWhere(ir, meta, dialect, locale);
  if (!isNull(where)) {
    parts.push(`WHERE ${where.sql}`);
    params.push(...where.params);
  }
  parts.push('LIMIT 1');
  assertBoundParams(params.length, dialect.maxParameters);
  const row = await useDatabase().queryOne<{ 1: number }>(parts.join(' '), params);
  return !isUndefined(row);
}
