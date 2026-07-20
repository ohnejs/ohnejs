import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedScope } from '../pipeline/run-record.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, hasKey, isEmpty, isUndefined } from '../../../utils/index.ts';
import { defaultPath, finishScalar, writeContext } from '../pipeline/run-field.ts';
import { columnTypes } from './insert.ts';

/**
 * Splits a processed scope's columns by home: the main table's, and the companion's per-locale ones.
 * A collection with no translatable column puts everything in `main` and an empty `companion`.
 */
export function splitColumns(
  fields: Record<string, FieldQueryMeta>,
  columns: Record<string, unknown>,
): { main: Record<string, unknown>; companion: Record<string, unknown> } {
  const main: Record<string, unknown> = {};
  const companion: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(columns)) {
    const home = fields[column]?.companion === true ? companion : main;
    home[column] = value;
  }
  return { main, companion };
}

/**
 * How a write's companion columns land per matched record: update the existing row, or materialize one.
 * `defaults` carries the values a materialized row fills its unwritten columns with.
 * `errors` carries each failing default's errors by its column.
 * They fail the call only when a row must actually materialize and the write leaves that column unfilled.
 */
export interface CompanionPlan {
  hasRow: ReadonlySet<string>;
  defaults: Record<string, unknown>;
  errors: Record<string, FieldErrors>;
}

/**
 * The plan a create's companion insert carries: no row exists yet, and every column is provided.
 * A create processes all fields, so it never resolves a default and never materializes over a row.
 */
export function emptyCompanionPlan(): CompanionPlan {
  return { hasRow: new Set(), defaults: {}, errors: {} };
}

/**
 * Plans the companion upsert: which matched records hold a row at the locale, plus the defaults.
 *
 * A write touching no companion column plans nothing - records without a translation keep lacking one.
 * Defaults resolve through the default path and value tiers under the update's own context.
 * A required companion field with no default lands in `errors`.
 * `materializeFailure` decides whether they fail the call, since a gated write may materialize nothing.
 * A field that is provided and ungated lands in every materialized row, so it never needs a default.
 */
export async function planCompanion(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  scope: ProcessedScope,
  matched: readonly string[],
  locale: string,
): Promise<CompanionPlan> {
  if (isUndefined(meta.companionTable)) return emptyCompanionPlan();
  if (isEmpty(splitColumns(meta.fields, scope.columns).companion)) return emptyCompanionPlan();

  const hasRow = new Set<string>();
  const table = dialect.quote(meta.companionTable);
  const parent = dialect.quote('_parentUUID');
  for (const batch of chunk(matched, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ parent: string }>(
      `SELECT ${parent} AS ${dialect.quote('parent')} FROM ${table} ` +
        `WHERE ${parent} IN (${marks}) AND ${dialect.quote('_localeCode')} = ?`,
      [...batch, locale],
    );
    for (const row of rows) hasRow.add(row.parent);
  }
  if (hasRow.size === matched.length) return { hasRow, defaults: {}, errors: {} };

  const ctx = {
    operation: 'update' as const,
    collection: meta.collection,
    tx,
    path: '',
    ancestors: [],
  };
  const errors: Record<string, FieldErrors> = {};
  const defaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(meta.fields)) {
    if (field.companion !== true) continue;
    if (hasKey(scope.columns, field.column as string) && isUndefined(field.when)) continue;
    const prepared = await defaultPath(name, field, writeContext(name, field, {}, ctx));
    if ('errors' in prepared) {
      errors[field.column as string] = prepared.errors;
      continue;
    }
    if (!('value' in prepared)) continue;
    const finished = await finishScalar(name, field, prepared.value, {}, ctx);
    if (!isUndefined(finished.errors)) errors[field.column as string] = finished.errors;
    else defaults[field.column as string] = finished.column?.value ?? null;
  }
  return { hasRow, defaults, errors };
}

/**
 * The plan's errors when this write would materialize a companion row it cannot fill, else `null`.
 * A write materializes only where it sets companion columns for a record lacking the locale's row.
 * Only columns the write leaves unfilled count: a column the write sets never needs its default.
 * A provided-and-active gated field therefore cannot fail on a default no row would take.
 */
export function materializeFailure(
  plan: CompanionPlan,
  companion: Record<string, unknown>,
  uuids: readonly string[],
): FieldErrors | null {
  if (isEmpty(plan.errors) || isEmpty(companion)) return null;
  if (!uuids.some((uuid) => !plan.hasRow.has(uuid))) return null;
  const errors: FieldErrors = {};
  for (const [column, failure] of Object.entries(plan.errors)) {
    if (!hasKey(companion, column)) Object.assign(errors, failure);
  }
  return isEmpty(errors) ? null : errors;
}

/**
 * Applies one scope's companion columns across `uuids` at the locale, one row per (record, locale).
 * Existing rows update; missing ones materialize as `defaults` overlaid with the written columns.
 * A create passes `emptyCompanionPlan`, so every `uuid` materializes from the provided columns alone.
 */
export async function upsertCompanion(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  columns: Record<string, unknown>,
  uuids: readonly string[],
  locale: string,
  plan: CompanionPlan,
): Promise<void> {
  const columnType = columnTypes(meta.fields);
  const table = dialect.quote(meta.companionTable as string);
  const parent = dialect.quote('_parentUUID');
  const updates = uuids.filter((uuid) => plan.hasRow.has(uuid));
  const inserts = uuids.filter((uuid) => !plan.hasRow.has(uuid));

  if (updates.length > 0) {
    const sets: string[] = [];
    const setParams: SQLValue[] = [];
    for (const [column, value] of Object.entries(columns)) {
      sets.push(`${dialect.quote(column)} = ?`);
      setParams.push(dialect.serialize(columnType.get(column) as LogicalType, value));
    }
    for (const batch of chunk(updates, 900)) {
      const marks = batch.map(() => '?').join(', ');
      await tx.run(
        `UPDATE ${table} SET ${sets.join(', ')} ` +
          `WHERE ${parent} IN (${marks}) AND ${dialect.quote('_localeCode')} = ?`,
        [...setParams, ...batch, locale],
      );
    }
  }

  if (inserts.length > 0) {
    const values = { ...plan.defaults, ...columns };
    const names = ['_parentUUID', '_localeCode', ...Object.keys(values)];
    const quoted = names.map((name) => dialect.quote(name)).join(', ');
    const serialized = Object.entries(values).map(([column, value]) =>
      dialect.serialize(columnType.get(column) as LogicalType, value),
    );
    const rows = inserts.map((uuid) => [uuid, locale, ...serialized] as SQLValue[]);
    for (const batch of chunk(rows, Math.max(1, Math.floor(900 / names.length)))) {
      const tuples = batch.map(() => `(${names.map(() => '?').join(', ')})`).join(', ');
      await tx.run(`INSERT INTO ${table} (${quoted}) VALUES ${tuples}`, batch.flat());
    }
  }
}
