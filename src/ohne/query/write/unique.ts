import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { UniqueProbe } from '../pipeline/run-record.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, groupBy, hasKey, isEmpty, isUndefined, uniqueArray } from '../../../utils/index.ts';

/**
 * Prechecks every set unique field against its table, naming each collision in one round trip.
 *
 * One compound `SELECT ? AS field ... UNION ALL ...` probes each uniquely-indexed column at once.
 * It binds the same serialized values the write will, so the probe and the write agree by construction.
 * A translatable field probes the companion, where its column and unique index live.
 * A plain `unique` there spans every locale; `uniquePerLocale` narrows the probe to the write's locale.
 * Only fields the write sets are probed, so an update leaves an untouched unique field alone.
 * `excludeUUIDs` drops the rows the write itself owns, so a kept value never collides with its own row.
 * The exclusion anchors by `UUID` on the main table and by `_parentUUID` on the companion.
 * A `null` value never collides: `col = NULL` is never true, matching SQLite's multi-null unique rule.
 * Returns a `notUnique` message keyed by each colliding field, or an empty map when the row is clear.
 */
export async function checkUnique(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  columns: Record<string, unknown>,
  locale: string,
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  const uniques = Object.entries(meta.fields).filter(
    ([, field]) =>
      (field.kind === 'column' || field.kind === 'record') &&
      field.options?.unique === true &&
      hasKey(columns, field.column as string),
  );
  if (uniques.length === 0) return {};

  const excludeMarks = excludeUUIDs.map(() => '?').join(', ');
  const selects: string[] = [];
  const params: SQLValue[] = [];
  for (const [name, field] of uniques) {
    const companion = field.companion === true;
    const table = dialect.quote(companion ? (meta.companionTable as string) : meta.table);
    const anchor = dialect.quote(companion ? '_parentUUID' : 'UUID');
    const exclude = excludeUUIDs.length === 0 ? '' : ` AND ${anchor} NOT IN (${excludeMarks})`;
    const scoped = companion && field.options?.uniquePerLocale === true;
    const scope = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
    const value = dialect.serialize(
      field.logicalType as LogicalType,
      columns[field.column as string],
    );
    selects.push(
      `SELECT ? AS ${dialect.quote('field')} FROM ${table} ` +
        `WHERE ${dialect.quote(field.column as string)} = ?${scope}${exclude}`,
    );
    params.push(name, value);
    if (scoped) params.push(locale);
    params.push(...excludeUUIDs);
  }

  const rows = await tx.query<{ field: string }>(selects.join(' UNION ALL '), params);
  const errors: FieldErrors = {};
  for (const row of rows) errors[row.field] = 'validation.notUnique';
  return errors;
}

/**
 * Prechecks every collection-level `unique` composite, naming a collision at each field it covers.
 *
 * One `SELECT ... WHERE col = ? AND ...` per composite, `UNION ALL`-ed into a single read.
 * A composite over translatable fields probes the companion; a plain one, the main table.
 * Only a composite the write sets in full is probed; a partial update falls to the driver's constraint.
 * `excludeUUIDs` drops the rows the write owns, anchored by `UUID` (main) or `_parentUUID` (companion).
 * A `null` anywhere in the tuple never collides: `col = NULL` is never true, matching the multi-null rule.
 * Returns `notUnique` at every field of each colliding composite, or an empty map when all are clear.
 */
export async function checkCompositeUnique(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  columns: Record<string, unknown>,
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  const probes = meta.compositeUniques.filter((composite) =>
    composite.fields.every((name) => hasKey(columns, meta.fields[name].column as string)),
  );
  if (probes.length === 0) return {};

  const excludeMarks = excludeUUIDs.map(() => '?').join(', ');
  const selects: string[] = [];
  const params: SQLValue[] = [];
  probes.forEach((composite, index) => {
    const companion = composite.companion;
    const table = dialect.quote(companion ? (meta.companionTable as string) : meta.table);
    const anchor = dialect.quote(companion ? '_parentUUID' : 'UUID');
    const exclude = excludeUUIDs.length === 0 ? '' : ` AND ${anchor} NOT IN (${excludeMarks})`;
    const matches = composite.fields
      .map((name) => `${dialect.quote(meta.fields[name].column as string)} = ?`)
      .join(' AND ');
    selects.push(`SELECT ? AS ${dialect.quote('which')} FROM ${table} WHERE ${matches}${exclude}`);
    params.push(String(index));
    for (const name of composite.fields) {
      const field = meta.fields[name];
      params.push(
        dialect.serialize(field.logicalType as LogicalType, columns[field.column as string]),
      );
    }
    params.push(...excludeUUIDs);
  });

  const rows = await tx.query<{ which: string }>(selects.join(' UNION ALL '), params);
  const errors: FieldErrors = {};
  for (const row of rows) {
    for (const name of probes[Number(row.which)].fields) errors[name] = 'validation.notUnique';
  }
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
 * Best-effort: without parsing the driver message it names every field a unique constraint covers.
 * Field-level and composite uniques both contribute their fields.
 * When none is unique the collision is a child-table constraint, so it falls back to a root error.
 */
export function uniqueRaceErrors(meta: CollectionQueryMeta): FieldErrors {
  const errors: FieldErrors = {};
  for (const [name, field] of Object.entries(meta.fields)) {
    if (field.options?.unique === true) errors[name] = 'validation.notUnique';
  }
  for (const composite of meta.compositeUniques) {
    for (const name of composite.fields) errors[name] = 'validation.notUnique';
  }
  if (isEmpty(errors)) errors[''] = 'validation.notUnique';
  return errors;
}
