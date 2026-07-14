import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { UniqueProbe } from '../pipeline/run-record.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, groupBy, hasKey, isEmpty, isUndefined, uniqueArray } from '../../../utils/index.ts';

/**
 * Prechecks every set unique field against the table, naming each collision in one round trip.
 *
 * One compound `SELECT ? AS field ... UNION ALL ...` probes each uniquely-indexed column at once.
 * It binds the same serialized values the write will, so the probe and the write agree by construction.
 * Only fields the write sets are probed, so an update leaves an untouched unique field alone.
 * `excludeUUIDs` drops the rows the write itself owns, so an update never collides a value with its own row.
 * A `null` value never collides: `col = NULL` is never true, matching SQLite's multi-null unique rule.
 * Returns a `notUnique` message keyed by each colliding field, or an empty map when the row is clear.
 */
export async function checkUnique(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  columns: Record<string, unknown>,
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  const uniques = Object.entries(meta.fields).filter(
    ([, field]) =>
      (field.kind === 'column' || field.kind === 'record') &&
      field.options?.unique === true &&
      hasKey(columns, field.column as string),
  );
  if (uniques.length === 0) return {};

  const table = dialect.quote(meta.table);
  const excludeMarks = excludeUUIDs.map(() => '?').join(', ');
  const exclude =
    excludeUUIDs.length === 0 ? '' : ` AND ${dialect.quote('UUID')} NOT IN (${excludeMarks})`;
  const selects: string[] = [];
  const params: SQLValue[] = [];
  for (const [name, field] of uniques) {
    const value = dialect.serialize(
      field.logicalType as LogicalType,
      columns[field.column as string],
    );
    selects.push(
      `SELECT ? AS ${dialect.quote('field')} FROM ${table} ` +
        `WHERE ${dialect.quote(field.column as string)} = ?${exclude}`,
    );
    params.push(name, value, ...excludeUUIDs);
  }

  const rows = await tx.query<{ field: string }>(selects.join(' UNION ALL '), params);
  const errors: FieldErrors = {};
  for (const row of rows) errors[row.field] = 'validation.notUnique';
  return errors;
}

/**
 * Prechecks every table-wide `unique` child value: a same-write repeat first, then an existing table row.
 *
 * Probes group by table and column, so each unique child column costs one batched `IN` read.
 * A value already used earlier in this write, or found in the table, errors at its exact dot-path.
 * `excludeUUIDs` drops the child rows an update rewrites: the matched records' whole subtree, at every depth.
 * A kept value then never collides with a row that is itself being rewritten.
 * A `null` never reaches here; the descent skips it, matching the multi-null unique rule.
 */
export async function checkChildUnique(
  tx: Transaction,
  dialect: Dialect,
  probes: readonly UniqueProbe[],
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  if (probes.length === 0) return {};

  const errors: FieldErrors = {};
  const excludeMarks = excludeUUIDs.map(() => '?').join(', ');
  const exclude =
    excludeUUIDs.length === 0 ? '' : ` AND ${dialect.quote('UUID')} NOT IN (${excludeMarks})`;
  const byColumn = groupBy(probes, (probe) => `${probe.table}.${probe.column}`);
  for (const group of Object.values(byColumn)) {
    if (isUndefined(group)) continue;
    const { table, column, logicalType } = group[0];
    const quotedColumn = dialect.quote(column);
    const values = group.map((probe) => dialect.serialize(logicalType, probe.value));

    const existing = new Set<SQLValue>();
    for (const batch of chunk(uniqueArray(values), 900)) {
      const marks = batch.map(() => '?').join(', ');
      const rows = await tx.query<{ value: SQLValue }>(
        `SELECT ${quotedColumn} AS ${dialect.quote('value')} FROM ${dialect.quote(table)} ` +
          `WHERE ${quotedColumn} IN (${marks})${exclude}`,
        [...batch, ...excludeUUIDs],
      );
      for (const row of rows) existing.add(row.value);
    }

    const seen = new Set<SQLValue>();
    for (let index = 0; index < group.length; index++) {
      const value = values[index];
      if (existing.has(value) || seen.has(value))
        errors[group[index].path] = 'validation.notUnique';
      else seen.add(value);
    }
  }
  return errors;
}

/**
 * The field-keyed error a caught unique violation falls back to when it escapes the precheck.
 * Best-effort: without parsing the driver message it names every top-level unique field.
 * When none is unique the collision is a child-table constraint, so it falls back to a root error.
 */
export function uniqueRaceErrors(meta: CollectionQueryMeta): FieldErrors {
  const errors: FieldErrors = {};
  for (const [name, field] of Object.entries(meta.fields)) {
    if (field.options?.unique === true) errors[name] = 'validation.notUnique';
  }
  if (isEmpty(errors)) errors[''] = 'validation.notUnique';
  return errors;
}
