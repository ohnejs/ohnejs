import type { ConditionNode } from '../../../utils/index.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';
import type { ScopeValues } from '../pipeline/when.ts';
import type { QueryRecord } from '../read/find.ts';
import type { FieldErrors } from './errors.ts';

import {
  chunk,
  evaluateCondition,
  first,
  groupBy,
  hasKey,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  uuidv7,
} from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { effectiveLocale } from '../locale.ts';
import { blockQueryMetadata, queryMetadata, type BlockQueryMeta } from '../metadata.ts';
import { prefixPath } from '../pipeline/prefix-errors.ts';
import { defaultPath, finishScalar, writeContext } from '../pipeline/run-field.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { whenResolver } from '../pipeline/when.ts';
import { readRows } from '../read/find.ts';
import { compileFrom } from '../sql/from.ts';
import { compileWhere } from '../sql/where.ts';
import {
  activeScope,
  gateNested,
  gateSubtree,
  hasNestedGates,
  isEmptyScope,
  itemSubfields,
  partitionActivation,
  whenGates,
  type WhenGate,
} from './activation.ts';
import {
  blockInstancesUnder,
  collectBlockSubtree,
  deleteBlockInstances,
  hasBlocksField,
  ownedBlockInstances,
} from './blocks.ts';
import { busyError } from './busy.ts';
import {
  appendPositions,
  columnTypes,
  insertScope,
  junctionColumns,
  splitColumns,
} from './insert.ts';
import { checkReferences } from './references.ts';
import { checkChildUnique, checkCompositeUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

/**
 * The outcome of an update: every matched record re-read in its final state, or the field failures.
 */
export type UpdateOutcome =
  | { ok: true; records: QueryRecord[] }
  | { ok: false; errors: FieldErrors };

/**
 * Updates every record the condition matches and returns them re-read, or the field failures.
 *
 * The pipeline runs once in `'update'` mode: only provided fields validate, and a field error stops the call.
 * The matched set resolves inside the transaction, then every derived write applies per matched record.
 * `locale` is the chain's explicit choice or `null`; translatable values land on the effective locale.
 * They upsert each matched record's companion row.
 * A missing row materializes, its unwritten companion columns filled through the default path.
 * Uniqueness prechecks exclude the matched rows, so a kept value never collides with its own record.
 * The returned records are all matched rows, untouched empty inputs included, in their final state.
 */
export async function runUpdate(
  collection: string,
  input: Record<string, unknown>,
  condition: ConditionNode,
  locale: string | null,
  joinedTx?: Transaction,
): Promise<UpdateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction(
          (tx) => attemptUpdate(tx, meta, dialect, input, condition, locale),
          'immediate',
        )
    : () => attemptUpdate(joinedTx, meta, dialect, input, condition, locale);
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    if (dialect.isUniqueViolation(error)) {
      return { ok: false, errors: uniqueRaceErrors(meta, dialect.uniqueViolationTarget(error)) };
    }
    if (dialect.isForeignKeyViolation(error)) {
      return { ok: false, errors: { '': 'validation.invalidReference' } };
    }
    throw error;
  }
}

/**
 * The update attempt inside the transaction: validate, resolve the matched set, precheck, then write.
 * Every precheck returns `{ ok: false }` before any write, so a failure leaves the database untouched.
 */
async function attemptUpdate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  input: Record<string, unknown>,
  condition: ConditionNode,
  locale: string | null,
): Promise<UpdateOutcome> {
  const processed = await runRecord(meta, input, { operation: 'update', tx });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;
  const code = effectiveLocale(locale);

  const matched = await matchedUUIDs(tx, dialect, meta, condition, code);
  if (matched.length === 0) return { ok: true, records: [] };

  const gates = whenGates(meta.fields, input, scope);
  const ungated = gates.length === 0 && !hasNestedGates(scope);

  if (ungated && matched.length > 1 && scope.uniqueProbes.length > 0) {
    const fanned: FieldErrors = {};
    for (const probe of scope.uniqueProbes) fanned[probe.path] = 'validation.notUnique';
    return { ok: false, errors: fanned };
  }

  const uniqueErrors = await checkUnique(tx, dialect, meta, scope.columns, code, matched);
  if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };

  const compositeUniqueErrors = await checkCompositeUnique(
    tx,
    dialect,
    meta,
    scope.columns,
    code,
    matched,
  );
  if (!isEmpty(compositeUniqueErrors)) return { ok: false, errors: compositeUniqueErrors };

  const excludeChildUUIDs =
    scope.uniqueProbes.length === 0
      ? []
      : await subtreeChildUUIDs(tx, dialect, meta.fields, matched, code);
  const childUniqueErrors = await checkChildUnique(
    tx,
    dialect,
    scope.uniqueProbes,
    excludeChildUUIDs,
  );
  if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };

  const referenceErrors = await checkReferences(tx, dialect, scope.refs);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const correlationErrors = await checkCorrelation(tx, dialect, matched, scope.children, code);
  if (!isEmpty(correlationErrors)) return { ok: false, errors: correlationErrors };

  const plan = await planCompanion(tx, dialect, meta, scope, matched, code);

  if (ungated) {
    const { main, companion } = splitColumns(meta.fields, scope.columns);
    const failure = materializeFailure(plan, companion, matched);
    if (!isNull(failure)) return { ok: false, errors: failure };
    await updateColumns(tx, dialect, meta.table, meta.fields, main, matched);
    if (!isEmpty(companion)) {
      await upsertCompanion(tx, dialect, meta, companion, matched, code, plan);
    }
    for (const uuid of matched) await applyDerived(tx, dialect, uuid, scope, null, code);
  } else {
    const failure = await gatedUpdate(tx, dialect, meta, matched, scope, gates, locale, plan);
    if (!isNull(failure)) return { ok: false, errors: failure };
  }

  return { ok: true, records: await readMatched(meta.collection, matched, locale) };
}

/**
 * Resolves the `UUID`s a condition matches, compiling the same `WHERE` clause the read path does.
 * A condition over translatable fields joins the companion at the effective locale, `LEFT`.
 * A write therefore addresses main rows; a missing translation compares as `NULL`, never dropping the row.
 */
async function matchedUUIDs(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  condition: ConditionNode,
  locale: string,
): Promise<string[]> {
  const where = compileWhere(condition, meta, dialect, locale);
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${uuid} AS ${dialect.quote('UUID')} ${from.sql} WHERE ${where.sql}`,
    [...from.params, ...where.params],
  );
  return rows.map((row) => row.UUID);
}

/**
 * How a write's companion columns land per matched record: update the existing row, or materialize one.
 * `defaults` carries the values a materialized row fills its unwritten columns with.
 * `errors` carries each failing default's errors by its column.
 * They fail the call only when a row must actually materialize and the write leaves that column unfilled.
 */
interface CompanionPlan {
  hasRow: ReadonlySet<string>;
  defaults: Record<string, unknown>;
  errors: Record<string, FieldErrors>;
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
async function planCompanion(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  scope: ProcessedScope,
  matched: readonly string[],
  locale: string,
): Promise<CompanionPlan> {
  const none: CompanionPlan = { hasRow: new Set(), defaults: {}, errors: {} };
  if (isUndefined(meta.companionTable)) return none;
  if (isEmpty(splitColumns(meta.fields, scope.columns).companion)) return none;

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
function materializeFailure(
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
 */
async function upsertCompanion(
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

/**
 * Proves every correlated composite item names an existing row on its parent, keyed at its exact path.
 * A repeater item's `UUID` must belong to the parent it sits under; a UUID matching nothing is an error.
 * Correlation recurses only into rows an update keeps: matched repeater items and an existing object row.
 * A blocks field proves its items through `checkBlockCorrelation`, instance identity and type alike.
 */
async function checkCorrelation(
  tx: Transaction,
  dialect: Dialect,
  parents: readonly string[],
  children: readonly ProcessedChild[],
  locale: string,
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  for (const child of children) {
    if (child.meta.kind === 'blocks') {
      Object.assign(errors, await checkBlockCorrelation(tx, dialect, parents, child, locale));
      continue;
    }
    const many = child.meta.kind === 'childMany';
    const correlatable = many
      ? child.items.some((item) => !isUndefined(item.itemUUID))
      : (child.items[0]?.children.length ?? 0) > 0;
    if (!correlatable) continue;
    const table = child.meta.table as string;
    const scoped = child.meta.localeScoped === true ? locale : null;
    for (const parent of parents) {
      const existing = await childUUIDs(tx, dialect, table, parent, scoped);
      if (many) {
        for (let index = 0; index < child.items.length; index++) {
          const uuid = child.items[index].itemUUID;
          if (isUndefined(uuid)) continue;
          if (!existing.has(uuid)) {
            errors[`${child.path}[${index}]`] = 'validation.invalidReference';
            continue;
          }
          Object.assign(
            errors,
            await checkCorrelation(tx, dialect, [uuid], child.items[index].children, locale),
          );
        }
      } else {
        const objectUUID = first([...existing]);
        if (!isUndefined(objectUUID)) {
          Object.assign(
            errors,
            await checkCorrelation(tx, dialect, [objectUUID], child.items[0].children, locale),
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Proves every correlated blocks item names one of the parent's own instances, its type unchanged.
 *
 * An item `UUID` outside the parent's (locale's) wrapper rows is an `invalidReference` at the item.
 * Foreign, cross-parent, and cross-locale claims read the same way.
 * A matched instance under a different `block` errors at the item's `UUID`.
 * An instance's type is immutable, so changing type means a new instance.
 * Matched items recurse into their nested children with the instance as parent.
 */
async function checkBlockCorrelation(
  tx: Transaction,
  dialect: Dialect,
  parents: readonly string[],
  child: ProcessedChild,
  locale: string,
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (!child.items.some((item) => !isUndefined(item.itemUUID))) return errors;
  const table = child.meta.table as string;
  const scoped = child.meta.localeScoped === true ? locale : null;
  for (const parent of parents) {
    const existing = await wrapperRows(tx, dialect, table, parent, scoped);
    const types = new Map(existing.map((row) => [row.instance, row.type]));
    for (let index = 0; index < child.items.length; index++) {
      const item = child.items[index];
      if (isUndefined(item.itemUUID)) continue;
      const type = types.get(item.itemUUID);
      if (isUndefined(type)) {
        errors[`${child.path}[${index}]`] = 'validation.invalidReference';
        continue;
      }
      if (type !== item.blockType) {
        errors[`${child.path}[${index}].UUID`] = 'validation.invalidReference';
        continue;
      }
      Object.assign(
        errors,
        await checkCorrelation(tx, dialect, [item.itemUUID], item.children, locale),
      );
    }
  }
  return errors;
}

/**
 * Applies one scope's column update across the matched rows, `_updatedAt` bumped even with no columns set.
 * The set clause is fixed per call, so it binds once and re-binds only the chunked `UUID` list.
 */
async function updateColumns(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  columns: Record<string, unknown>,
  matched: readonly string[],
): Promise<void> {
  const columnType = columnTypes(fields);
  const sets: string[] = [];
  const setParams: SQLValue[] = [];
  for (const [column, value] of Object.entries(columns)) {
    sets.push(`${dialect.quote(column)} = ?`);
    setParams.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  sets.push(`${dialect.quote('_updatedAt')} = ?`);
  setParams.push(Date.now());

  const setClause = sets.join(', ');
  for (const batch of chunk(matched, 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(
      `UPDATE ${dialect.quote(table)} SET ${setClause} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...setParams, ...batch],
    );
  }
}

/**
 * Applies one existing row's derived writes: junction diffs for its relations, correlation for its children.
 * The `ancestry` carries each matched parent's resolution context down for nested gating.
 * It is `null` on the cheap path, where no field gates and every child writes verbatim.
 */
async function applyDerived(
  tx: Transaction,
  dialect: Dialect,
  uuid: string,
  scope: ProcessedScope,
  ancestry: readonly ScopeValues[] | null,
  locale: string,
): Promise<void> {
  for (const relation of scope.relations) await diffJunction(tx, dialect, relation, uuid, locale);
  for (const child of scope.children) {
    if (child.meta.kind === 'blocks') {
      await correlateBlocks(tx, dialect, child, uuid, ancestry, locale);
      continue;
    }
    await correlateChild(tx, dialect, child, uuid, ancestry, locale);
  }
}

/**
 * Applies an update whose top-level fields or nested subfields gate, deciding activation per matched record.
 *
 * Top-level fields partition the matched records by signature, dropping each inactive gate's column and rows.
 * A record whose whole top-level signature is inactive is untouched, with no `_updatedAt` bump.
 * Each record's overlay is its stored shape under the pipeline's coerced provided values.
 * `scope.values` is the same substrate a create's gates read.
 * A nested `when` reaching the root therefore reads that record's stored state.
 * A `has`/`empty` gate over a relation or composite reads its persisted membership; validation ran call-wide.
 */
async function gatedUpdate(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  matched: readonly string[],
  scope: ProcessedScope,
  gates: readonly WhenGate[],
  locale: string | null,
  plan: CompanionPlan,
): Promise<FieldErrors | null> {
  const code = effectiveLocale(locale);
  const records = await readMatched(meta.collection, matched, locale);
  const overlays = new Map(
    records.map((record) => [record.UUID as string, { ...record, ...scope.values }]),
  );
  for (const record of records) {
    const ancestry = [overlays.get(record.UUID as string) as ScopeValues];
    const failure = gatedResetErrors(scope.children, ancestry);
    if (!isNull(failure)) return failure;
  }
  const writes: {
    groupScope: ProcessedScope;
    uuids: readonly string[];
    main: Record<string, unknown>;
    companion: Record<string, unknown>;
  }[] = [];
  for (const group of partitionActivation(records, gates, scope.values)) {
    const groupScope = activeScope(scope, gates, group.active);
    if (isEmptyScope(groupScope)) continue;
    const { main, companion } = splitColumns(meta.fields, groupScope.columns);
    const failure = materializeFailure(plan, companion, group.uuids);
    if (!isNull(failure)) return failure;
    writes.push({ groupScope, uuids: group.uuids, main, companion });
  }
  for (const { groupScope, uuids, main, companion } of writes) {
    await updateColumns(tx, dialect, meta.table, meta.fields, main, uuids);
    if (!isEmpty(companion)) {
      await upsertCompanion(tx, dialect, meta, companion, uuids, code, plan);
    }
    for (const uuid of uuids) {
      await applyDerived(tx, dialect, uuid, groupScope, [overlays.get(uuid) as ScopeValues], code);
    }
  }
  return null;
}

/**
 * The failures of gated defaults this walk's deactivations actually need, or `null` when none.
 *
 * Mirrors `gateNested`'s decision purely: each item's subfield `when` resolves over the same ancestry.
 * An inactive subfield whose default failed contributes its errors at the item's absolute path.
 * A create with that item's input fails identically, so the update rejects cleanly before any write.
 * Runs per matched record, since a gate may deactivate for one record and hold for another.
 */
function gatedResetErrors(
  children: readonly ProcessedChild[],
  ancestry: readonly ScopeValues[],
): FieldErrors | null {
  let errors: FieldErrors | null = null;
  for (const child of children) {
    for (const [index, item] of child.items.entries()) {
      const itemPath =
        child.meta.kind === 'childOne'
          ? child.path
          : child.meta.kind === 'blocks'
            ? `${child.path}[${index}].fields`
            : `${child.path}[${index}]`;
      const failures = item.gatedDefaultErrors;
      if (!isUndefined(failures)) {
        const resolve = whenResolver(item.values, ancestry);
        for (const [name, meta] of Object.entries(itemSubfields(child, item))) {
          if (isUndefined(meta.when) || evaluateCondition(meta.when, resolve)) continue;
          for (const [key, message] of Object.entries(failures)) {
            if (key !== name && !key.startsWith(`${name}.`) && !key.startsWith(`${name}[`))
              continue;
            (errors ??= {})[prefixPath(itemPath, key)] = message;
          }
        }
      }
      const nested = gatedResetErrors(item.children, [...ancestry, item.values]);
      if (!isNull(nested)) Object.assign((errors ??= {}), nested);
    }
  }
  return errors;
}

/**
 * Diffs one `records` field's junction against the input: delete removed, insert added, renumber kept.
 *
 * Added links append their `linkPosition` per target, exactly as a create does.
 * Kept links keep their `linkPosition` - the target's own ordering - and only their `selfPosition` renumbers.
 * A locale-scoped junction diffs one locale's links: every read, delete, insert, and renumber binds it.
 * An unchanged input issues no writes at all, since every removal, addition, and renumber is empty.
 */
async function diffJunction(
  tx: Transaction,
  dialect: Dialect,
  relation: ProcessedRelation,
  ownerUUID: string,
  locale: string,
): Promise<void> {
  const cols = junctionColumns(relation.meta);
  const table = dialect.quote(cols.table);
  const self = dialect.quote(cols.self);
  const link = dialect.quote(cols.link);
  const selfPos = dialect.quote(cols.selfPosition);
  const scoped = relation.meta.localeScoped === true;
  const filter = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
  const scopeParams: SQLValue[] = scoped ? [locale] : [];

  const existing = await tx.query<{ target: string; pos: number }>(
    `SELECT ${link} AS "target", ${selfPos} AS "pos" FROM ${table} WHERE ${self} = ?${filter}`,
    [ownerUUID, ...scopeParams],
  );
  const currentPos = new Map<string, number>(existing.map((row) => [row.target, row.pos]));
  const targets = relation.uuids;
  const inputSet = new Set(targets);

  const removed = existing.map((row) => row.target).filter((target) => !inputSet.has(target));
  for (const batch of chunk(removed, 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(`DELETE FROM ${table} WHERE ${self} = ? AND ${link} IN (${marks})${filter}`, [
      ownerUUID,
      ...batch,
      ...scopeParams,
    ]);
  }

  const added = targets.filter((target) => !currentPos.has(target));
  if (added.length > 0) {
    const nextByTarget = await appendPositions(
      tx,
      dialect,
      cols.table,
      cols.link,
      cols.linkPosition,
      added,
      scoped ? locale : null,
    );
    const rows: SQLValue[][] = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (currentPos.has(target)) continue;
      const linkPosition = nextByTarget.get(target) ?? 0;
      nextByTarget.set(target, linkPosition + 1);
      const row: SQLValue[] = [ownerUUID, target, index, linkPosition];
      if (scoped) row.push(locale);
      rows.push(row);
    }
    const columns = [cols.self, cols.link, cols.selfPosition, cols.linkPosition];
    if (scoped) columns.push('_localeCode');
    const quoted = columns.map((column) => dialect.quote(column)).join(', ');
    for (const batch of chunk(rows, Math.floor(900 / columns.length))) {
      const tuples = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      await tx.run(`INSERT INTO ${table} (${quoted}) VALUES ${tuples}`, batch.flat());
    }
  }

  for (let index = 0; index < targets.length; index++) {
    const current = currentPos.get(targets[index]);
    if (isUndefined(current) || current === index) continue;
    await tx.run(`UPDATE ${table} SET ${selfPos} = ? WHERE ${self} = ? AND ${link} = ?${filter}`, [
      index,
      ownerUUID,
      targets[index],
      ...scopeParams,
    ]);
  }
}

/**
 * Correlates one composite field's items against the existing child rows, updating, inserting, and deleting.
 *
 * A repeater matches by item `UUID`: a match updates, an unmatched row deletes, a new item inserts.
 * An `object` upserts its single row by parent: an empty list clears it, a value sets it.
 * A doomed row's nested block instances delete with it: the wrapper rows cascade, per-type rows do not.
 * A matched or existing row keeps its identity, so a nested repeater's own items correlate one level down.
 * When `ancestry` is set, each item gates per this parent, resolving its subfields' `when` against it.
 * A matched item narrows in place; a fresh item and its whole subtree pre-gate before the insert.
 * The recursion extends the ancestry with the item's own values.
 */
async function correlateChild(
  tx: Transaction,
  dialect: Dialect,
  child: ProcessedChild,
  parentUUID: string,
  ancestry: readonly ScopeValues[] | null,
  locale: string,
): Promise<void> {
  const table = child.meta.table as string;
  const subfields = child.meta.subfields as Record<string, FieldQueryMeta>;
  const scoped = child.meta.localeScoped === true;
  const existing = await childUUIDs(tx, dialect, table, parentUUID, scoped ? locale : null);

  if (child.meta.kind === 'childOne') {
    const objectUUID = first([...existing]);
    const item = first(child.items);
    if (isUndefined(item)) {
      if (!isUndefined(objectUUID)) {
        await deleteChildrenWithBlocks(tx, dialect, table, subfields, [objectUUID]);
      }
      return;
    }
    if (isUndefined(objectUUID)) {
      const fresh = isNull(ancestry) ? item : gateSubtree(item, subfields, ancestry);
      await insertScope(tx, dialect, table, subfields, uuidv7(), fresh, locale, {
        uuid: parentUUID,
        scoped,
      });
      return;
    }
    const gated = isNull(ancestry) ? item : gateNested(item, subfields, ancestry);
    await updateChildRow(tx, dialect, table, subfields, gated, objectUUID);
    await applyDerived(tx, dialect, objectUUID, gated, descend(ancestry, item), locale);
    return;
  }

  const consumed = new Set(child.items.map((item) => item.itemUUID).filter(isString));
  await deleteChildrenWithBlocks(
    tx,
    dialect,
    table,
    subfields,
    [...existing].filter((uuid) => !consumed.has(uuid)),
  );
  for (let index = 0; index < child.items.length; index++) {
    const item = child.items[index];
    if (isUndefined(item.itemUUID)) {
      const fresh = isNull(ancestry) ? item : gateSubtree(item, subfields, ancestry);
      await insertScope(tx, dialect, table, subfields, uuidv7(), fresh, locale, {
        uuid: parentUUID,
        position: index,
        scoped,
      });
      continue;
    }
    const gated = isNull(ancestry) ? item : gateNested(item, subfields, ancestry);
    await updateChildRow(tx, dialect, table, subfields, gated, item.itemUUID, index);
    await applyDerived(tx, dialect, item.itemUUID, gated, descend(ancestry, item), locale);
  }
}

/**
 * Extends a nested-gating ancestry by one level with the item's own values, or stays `null` on the cheap path.
 */
function descend(
  ancestry: readonly ScopeValues[] | null,
  item: ProcessedScope,
): readonly ScopeValues[] | null {
  return isNull(ancestry) ? null : [...ancestry, item.values];
}

/**
 * Correlates one blocks field's items against the parent's wrapper rows by instance `UUID`.
 *
 * An unmatched wrapper row deletes with its whole instance subtree.
 * The write path owns the polymorphic link's cleanup; instances are exclusively this parent's.
 * A fresh item inserts a new instance and the wrapper row placing it at the item's index.
 * A matched item updates its per-type row and renumbers the wrapper only when its position moved.
 * It recurses into the instance's own nested structures.
 * When `ancestry` is set, each item's subfields gate through its block type, exactly as child items do.
 */
async function correlateBlocks(
  tx: Transaction,
  dialect: Dialect,
  child: ProcessedChild,
  parentUUID: string,
  ancestry: readonly ScopeValues[] | null,
  locale: string,
): Promise<void> {
  const table = child.meta.table as string;
  const scoped = child.meta.localeScoped === true;
  const existing = await wrapperRows(tx, dialect, table, parentUUID, scoped ? locale : null);
  const byInstance = new Map(existing.map((row) => [row.instance, row]));

  const consumed = new Set(child.items.map((item) => item.itemUUID).filter(isString));
  const removed = existing.filter((row) => !consumed.has(row.instance));
  if (removed.length > 0) {
    const doomed = await collectBlockSubtree(
      tx,
      dialect,
      removed.map((row) => ({ type: row.type, uuid: row.instance })),
    );
    await deleteChildren(
      tx,
      dialect,
      table,
      removed.map((row) => row.uuid),
    );
    await deleteBlockInstances(tx, dialect, doomed);
  }

  for (let index = 0; index < child.items.length; index++) {
    const item = child.items[index];
    const blockMeta = blockQueryMetadata(item.blockType as string);
    if (isUndefined(item.itemUUID)) {
      const fresh = isNull(ancestry) ? item : gateSubtree(item, blockMeta.fields, ancestry);
      await insertBlockItem(tx, dialect, child.meta, blockMeta, fresh, parentUUID, index, locale);
      continue;
    }
    const gated = isNull(ancestry) ? item : gateNested(item, blockMeta.fields, ancestry);
    await updateChildRow(tx, dialect, blockMeta.table, blockMeta.fields, gated, item.itemUUID);
    const wrapper = byInstance.get(item.itemUUID) as WrapperRow;
    if (wrapper.position !== index) {
      await tx.run(
        `UPDATE ${dialect.quote(table)} SET ${dialect.quote('_parentPosition')} = ? ` +
          `WHERE ${dialect.quote('UUID')} = ?`,
        [index, wrapper.uuid],
      );
    }
    await applyDerived(tx, dialect, item.itemUUID, gated, descend(ancestry, item), locale);
  }
}

/**
 * Inserts one fresh blocks item: its instance row, subtree included, then the wrapper row placing it.
 * The instance inserts through `insertScope`'s block mode, so its nested structures hang off it.
 * The wrapper stamps `_localeCode` when the field is locale-scoped.
 */
async function insertBlockItem(
  tx: Transaction,
  dialect: Dialect,
  meta: FieldQueryMeta,
  blockMeta: BlockQueryMeta,
  item: ProcessedScope,
  parentUUID: string,
  position: number,
  locale: string,
): Promise<void> {
  const instance = uuidv7();
  await insertScope(
    tx,
    dialect,
    blockMeta.table,
    blockMeta.fields,
    instance,
    item,
    locale,
    'block',
  );
  const columns = ['UUID', '_parentUUID', '_parentPosition', '_blockType', '_blockUUID'];
  const values: SQLValue[] = [uuidv7(), parentUUID, position, blockMeta.name, instance];
  if (meta.localeScoped === true) {
    columns.push('_localeCode');
    values.push(locale);
  }
  const marks = columns.map(() => '?').join(', ');
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  await tx.run(
    `INSERT INTO ${dialect.quote(meta.table as string)} (${quoted}) VALUES (${marks})`,
    values,
  );
}

/**
 * Updates one existing child row's columns, and its `_parentPosition` when it belongs to a repeater.
 * A row with nothing to set - an object item carrying only nested composites - issues no column write.
 */
async function updateChildRow(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  item: ProcessedScope,
  uuid: string,
  position?: number,
): Promise<void> {
  const columnType = columnTypes(subfields);
  const sets: string[] = [];
  const params: SQLValue[] = [];
  for (const [column, value] of Object.entries(item.columns)) {
    sets.push(`${dialect.quote(column)} = ?`);
    params.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  if (!isUndefined(position)) {
    sets.push(`${dialect.quote('_parentPosition')} = ?`);
    params.push(position);
  }
  if (sets.length === 0) return;
  params.push(uuid);
  await tx.run(
    `UPDATE ${dialect.quote(table)} SET ${sets.join(', ')} WHERE ${dialect.quote('UUID')} = ?`,
    params,
  );
}

/**
 * The `UUID`s of one parent's child rows in a composite table, for correlation and deletion.
 * A locale-scoped table passes the locale, so another locale's items never correlate or delete.
 */
async function childUUIDs(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parentUUID: string,
  locale: string | null,
): Promise<Set<string>> {
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
      `WHERE ${dialect.quote('_parentUUID')} = ?${filter}`,
    isNull(locale) ? [parentUUID] : [parentUUID, locale],
  );
  return new Set(rows.map((row) => row.UUID));
}

/**
 * One wrapper row of a blocks field: its own key, the placed instance, its type, and its position.
 */
interface WrapperRow {
  uuid: string;
  instance: string;
  type: string;
  position: number;
}

/**
 * One parent's wrapper rows in a blocks field's table, for correlation, renumbering, and deletion.
 * A locale-scoped wrapper passes the locale, so another locale's items never correlate or delete.
 */
async function wrapperRows(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parentUUID: string,
  locale: string | null,
): Promise<WrapperRow[]> {
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  return tx.query<WrapperRow>(
    `SELECT ${dialect.quote('UUID')} AS ${dialect.quote('uuid')}, ` +
      `${dialect.quote('_blockUUID')} AS ${dialect.quote('instance')}, ` +
      `${dialect.quote('_blockType')} AS ${dialect.quote('type')}, ` +
      `${dialect.quote('_parentPosition')} AS ${dialect.quote('position')} ` +
      `FROM ${dialect.quote(table)} WHERE ${dialect.quote('_parentUUID')} = ?${filter}`,
    isNull(locale) ? [parentUUID] : [parentUUID, locale],
  );
}

/**
 * Every existing composite child row under the matched records, at every nesting depth.
 *
 * An update rewrites the whole subtree of a matched record, so the precheck excludes these rows.
 * A kept value then never collides with a row that is itself being rewritten.
 * A blocks field contributes its instances by per-type row `UUID`, what its probes anchor on.
 * It recurses into each instance's own children.
 * Resolved only when the write carries a table-wide-unique composite probe, so the common write pays nothing.
 */
async function subtreeChildUUIDs(
  tx: Transaction,
  dialect: Dialect,
  fields: Record<string, FieldQueryMeta>,
  parents: readonly string[],
  locale: string,
): Promise<string[]> {
  const all: string[] = [];
  for (const field of Object.values(fields)) {
    if (field.kind === 'blocks') {
      const scoped = field.localeScoped === true ? locale : null;
      const instances = await blockInstancesUnder(
        tx,
        dialect,
        field.table as string,
        parents,
        scoped,
      );
      if (instances.length === 0) continue;
      all.push(...instances.map((instance) => instance.uuid));
      const byType = groupBy(instances, (instance) => instance.type);
      for (const [type, group] of Object.entries(byType)) {
        if (isUndefined(group)) continue;
        all.push(
          ...(await subtreeChildUUIDs(
            tx,
            dialect,
            blockQueryMetadata(type).fields,
            group.map((instance) => instance.uuid),
            locale,
          )),
        );
      }
      continue;
    }
    if (field.kind !== 'childOne' && field.kind !== 'childMany') continue;
    const scoped = field.localeScoped === true ? locale : null;
    const rows = await childUUIDsUnder(tx, dialect, field.table as string, parents, scoped);
    if (rows.length === 0) continue;
    all.push(...rows);
    all.push(
      ...(await subtreeChildUUIDs(
        tx,
        dialect,
        field.subfields as Record<string, FieldQueryMeta>,
        rows,
        locale,
      )),
    );
  }
  return all;
}

/**
 * The `UUID`s of one composite table's rows under any of `parents`, chunked for the driver's `IN` limit.
 * A locale-scoped table passes the locale: an update rewrites one locale's rows, so only those exclude.
 */
async function childUUIDsUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
): Promise<string[]> {
  const uuids: string[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ UUID: string }>(
      `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    uuids.push(...rows.map((row) => row.UUID));
  }
  return uuids;
}

/**
 * Deletes the named child rows, their own nested children following through `ON DELETE CASCADE`.
 */
async function deleteChildren(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  uuids: readonly string[],
): Promise<void> {
  for (const batch of chunk(uuids, 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(
      `DELETE FROM ${dialect.quote(table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...batch],
    );
  }
}

/**
 * Deletes the named child rows with the block instances their subtrees place.
 *
 * The rows' nested wrapper rows cascade; the polymorphic per-type rows do not, so they collect first.
 * A subfield tree that cannot hold blocks pays nothing: the metadata walk gates the collection.
 */
async function deleteChildrenWithBlocks(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  uuids: readonly string[],
): Promise<void> {
  if (uuids.length === 0) return;
  const doomed = hasBlocksField(subfields)
    ? await collectBlockSubtree(
        tx,
        dialect,
        await ownedBlockInstances(tx, dialect, subfields, uuids),
      )
    : [];
  await deleteChildren(tx, dialect, table, uuids);
  await deleteBlockInstances(tx, dialect, doomed);
}

/**
 * Re-reads the matched records in their final state, chunked so a large update stays under the param cap.
 */
async function readMatched(
  collection: string,
  matched: readonly string[],
  locale: string | null,
): Promise<QueryRecord[]> {
  const records: QueryRecord[] = [];
  for (const batch of chunk(matched, 2000)) {
    const rows = await readRows({
      collection,
      condition: { kind: 'compare', path: ['UUID'], op: 'in', value: batch, negated: false },
      select: null,
      order: [],
      limit: null,
      offset: null,
      populate: [],
      locale,
    });
    records.push(...rows);
  }
  return records;
}
