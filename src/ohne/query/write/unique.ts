import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType, UniqueViolationTarget } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { UniqueProbe } from '../pipeline/run-record.ts';
import type { FieldErrors } from './errors.ts';

import {
  chunk,
  groupBy,
  hasKey,
  isEmpty,
  isNull,
  isUndefined,
  uniqueArray,
} from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';

/**
 * Prechecks every set unique field against its table, naming each collision in one round trip.
 *
 * One compound `SELECT ? AS field ... UNION ALL ...` probes each uniquely-indexed column at once.
 * It binds the same serialized values the write will, so the probe and the write agree by construction.
 * A translatable field probes the companion, where its column and unique index live.
 * A plain `unique` there spans every locale; `uniquePerLocale` narrows the probe to the write's locale.
 * Only fields the write sets are probed, so an update leaves an untouched unique field alone.
 * `excludeUUIDs` drops the rows the write itself owns, so a kept value never collides with its own row.
 * Each hit returns its anchor - `UUID` on the main table, `_parentUUID` on the companion.
 * Owned rows filter out in memory, so the exclusion binds no parameters a bulk update could overrun.
 * On the companion only the write's locale filters, since only that locale's rows rewrite.
 * A record's own other-locale row therefore still probes against a locale-spanning `unique`.
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
  if (isEmpty(uniques)) return {};

  const selects: string[] = [];
  const params: SQLValue[] = [];
  for (const [name, field] of uniques) {
    const companion = field.companion === true;
    const table = dialect.quote(companion ? (meta.companionTable as string) : meta.table);
    const anchor = dialect.quote(companion ? '_parentUUID' : 'UUID');
    const rowLocale = companion ? dialect.quote('_localeCode') : 'NULL';
    const scoped = companion && field.options?.uniquePerLocale === true;
    const scope = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
    const value = dialect.serialize(
      field.logicalType as LogicalType,
      columns[field.column as string],
    );
    selects.push(
      `SELECT ? AS ${dialect.quote('field')}, ${anchor} AS ${dialect.quote('anchor')}, ` +
        `${rowLocale} AS ${dialect.quote('locale')} FROM ${table} ` +
        `WHERE ${dialect.quote(field.column as string)} = ?${scope}`,
    );
    params.push(name, value);
    if (scoped) params.push(locale);
  }

  const rows = await tx.query<{ field: string; anchor: string; locale: string | null }>(
    selects.join(' UNION ALL '),
    params,
  );
  const owned = new Set(excludeUUIDs);
  const errors: FieldErrors = {};
  for (const row of rows) {
    if (!isOwnedRow(row, owned, locale)) errors[row.field] = 'validation.notUnique';
  }
  return errors;
}

/**
 * Prechecks every collection-level `unique` composite, naming a collision at each field it covers.
 *
 * One `SELECT ... WHERE col = ? AND ...` per composite, `UNION ALL`-ed into a single read.
 * A composite over translatable fields probes the companion; a plain one, the main table.
 * Only a composite the write sets in full is probed; a partial update falls to the driver's constraint.
 * `excludeUUIDs` drops the rows the write owns, anchored by `UUID` (main) or `_parentUUID` (companion).
 * Owned rows filter out in memory at the write's locale, exactly as `checkUnique`'s exclusion does.
 * A `null` anywhere in the tuple never collides: `col = NULL` is never true, matching the multi-null rule.
 * Returns `notUnique` at every field of each colliding composite, or an empty map when all are clear.
 */
export async function checkCompositeUnique(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  columns: Record<string, unknown>,
  locale: string,
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  const probes = meta.compositeUniques.filter((composite) =>
    composite.fields.every((name) => hasKey(columns, meta.fields[name].column as string)),
  );
  if (isEmpty(probes)) return {};

  const selects: string[] = [];
  const params: SQLValue[] = [];
  probes.forEach((composite, index) => {
    const companion = composite.companion;
    const table = dialect.quote(companion ? (meta.companionTable as string) : meta.table);
    const anchor = dialect.quote(companion ? '_parentUUID' : 'UUID');
    const rowLocale = companion ? dialect.quote('_localeCode') : 'NULL';
    const matches = composite.fields
      .map((name) => `${dialect.quote(meta.fields[name].column as string)} = ?`)
      .join(' AND ');
    selects.push(
      `SELECT ? AS ${dialect.quote('which')}, ${anchor} AS ${dialect.quote('anchor')}, ` +
        `${rowLocale} AS ${dialect.quote('locale')} FROM ${table} WHERE ${matches}`,
    );
    params.push(String(index));
    for (const name of composite.fields) {
      const field = meta.fields[name];
      params.push(
        dialect.serialize(field.logicalType as LogicalType, columns[field.column as string]),
      );
    }
  });

  const rows = await tx.query<{ which: string; anchor: string; locale: string | null }>(
    selects.join(' UNION ALL '),
    params,
  );
  const owned = new Set(excludeUUIDs);
  const errors: FieldErrors = {};
  for (const row of rows) {
    if (isOwnedRow(row, owned, locale)) continue;
    for (const name of probes[Number(row.which)].fields) errors[name] = 'validation.notUnique';
  }
  return errors;
}

/**
 * Whether a probe hit is a row the write itself owns, filtered in memory rather than as bound SQL.
 * A main-table hit carries a `null` locale and excludes by anchor alone.
 * A companion hit excludes only at the write's locale, so an owned other-locale row still collides.
 */
function isOwnedRow(
  row: { anchor: string; locale: string | null },
  owned: ReadonlySet<string>,
  locale: string,
): boolean {
  return owned.has(row.anchor) && (isNull(row.locale) || row.locale === locale);
}

/**
 * Prechecks every table-wide `unique` child value: a same-write repeat first, then an existing table row.
 *
 * Probes group by table and column, so each unique child column costs one batched `IN` read.
 * A value already used earlier in this write, or found in the table, errors at its exact dot-path.
 * `excludeUUIDs` drops the child rows an update rewrites: the matched records' whole subtree, at every depth.
 * A kept value then never collides with a row that is itself being rewritten.
 * Owned rows filter out in memory by `UUID`, so the subtree list never binds as parameters.
 * A `null` never reaches here; the descent skips it, matching the multi-null unique rule.
 */
export async function checkChildUnique(
  tx: Transaction,
  dialect: Dialect,
  probes: readonly UniqueProbe[],
  excludeUUIDs: readonly string[] = [],
): Promise<FieldErrors> {
  if (isEmpty(probes)) return {};

  const errors: FieldErrors = {};
  const owned = new Set(excludeUUIDs);
  const byColumn = groupBy(probes, (probe) => `${probe.table}.${probe.column}`);
  for (const group of Object.values(byColumn)) {
    if (isUndefined(group)) continue;
    const { table, column, logicalType } = group[0];
    const quotedColumn = dialect.quote(column);
    const values = group.map((probe) => dialect.serialize(logicalType, probe.value));

    const existing = new Set<SQLValue>();
    for (const batch of chunk(uniqueArray(values), 900)) {
      const marks = batch.map(() => '?').join(', ');
      const rows = await tx.query<{ value: SQLValue; UUID: string }>(
        `SELECT ${quotedColumn} AS ${dialect.quote('value')}, ` +
          `${dialect.quote('UUID')} AS ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
          `WHERE ${quotedColumn} IN (${marks})`,
        [...batch],
      );
      for (const row of rows) if (!owned.has(row.UUID)) existing.add(row.value);
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
 *
 * The dialect's parsed target maps back through metadata, so the failure blames the exact field.
 * A main or companion column names its top-level field; a child or block column its dotted subfield path.
 * The path is dotted - `items.slug` - since the constraint alone cannot name the item's index.
 * When nothing maps, every unique field the collection declares is named, or the root when none is.
 */
export function uniqueRaceErrors(
  meta: CollectionQueryMeta,
  target: UniqueViolationTarget | null,
): FieldErrors {
  const mapped = isNull(target) ? null : violationErrors(meta, target);
  if (!isNull(mapped)) return mapped;
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

/**
 * Maps a violation's table and columns to field-keyed errors, or `null` when nothing maps.
 * The main and companion tables key at top-level field names; derived tables search the field tree.
 * System columns (`_localeCode`, `_parentUUID`) are skipped - the field columns beside them decide.
 */
function violationErrors(
  meta: CollectionQueryMeta,
  target: UniqueViolationTarget,
): FieldErrors | null {
  if (target.table === meta.table || target.table === meta.companionTable) {
    const companion = target.table === meta.companionTable;
    const errors: FieldErrors = {};
    for (const column of target.columns) {
      if (column.startsWith('_')) continue;
      const named = Object.entries(meta.fields).find(
        ([, field]) => field.column === column && (field.companion === true) === companion,
      );
      if (isUndefined(named)) return null;
      errors[named[0]] = 'validation.notUnique';
    }
    return isEmpty(errors) ? null : errors;
  }
  return derivedViolationErrors(meta.fields, '', target, new Set());
}

/**
 * Searches relation, composite, and block subtrees for the violated table, keying under the field's path.
 * A junction's constraint keys at the `records` field itself; a child or block table at its subfield.
 * `seen` guards the block descent, since a block may nest itself.
 */
function derivedViolationErrors(
  fields: Record<string, FieldQueryMeta>,
  prefix: string,
  target: UniqueViolationTarget,
  seen: Set<string>,
): FieldErrors | null {
  for (const [name, field] of Object.entries(fields)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (field.kind === 'records' && field.table === target.table) {
      return { [path]: 'validation.notUnique' };
    }
    if (field.kind === 'childOne' || field.kind === 'childMany') {
      const subfields = field.subfields as Record<string, FieldQueryMeta>;
      if (field.table === target.table) {
        const errors = subfieldErrors(subfields, path, target.columns);
        if (!isNull(errors)) return errors;
      }
      const nested = derivedViolationErrors(subfields, path, target, seen);
      if (!isNull(nested)) return nested;
    }
    if (field.kind === 'blocks') {
      for (const type of field.allow ?? []) {
        if (seen.has(type)) continue;
        seen.add(type);
        const block = blockQueryMetadata(type);
        if (block.table === target.table) {
          const errors = subfieldErrors(block.fields, path, target.columns);
          if (!isNull(errors)) return errors;
        }
        const nested = derivedViolationErrors(block.fields, path, target, seen);
        if (!isNull(nested)) return nested;
      }
    }
  }
  return null;
}

/**
 * Keys a violated table's field columns under `prefix`, or `null` when none maps to a subfield.
 */
function subfieldErrors(
  fields: Record<string, FieldQueryMeta>,
  prefix: string,
  columns: readonly string[],
): FieldErrors | null {
  const errors: FieldErrors = {};
  for (const column of columns) {
    if (column.startsWith('_')) continue;
    const named = Object.entries(fields).find(([, field]) => field.column === column);
    if (isUndefined(named)) return null;
    errors[`${prefix}.${named[0]}`] = 'validation.notUnique';
  }
  return isEmpty(errors) ? null : errors;
}
