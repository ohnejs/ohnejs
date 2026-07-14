import type { ConditionNode } from '../../../utils/index.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';
import type { QueryRecord } from '../read/find.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, first, isEmpty, isString, isUndefined, uuidv7 } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { queryMetadata } from '../metadata.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { readRows } from '../read/find.ts';
import { compileWhere } from '../sql/where.ts';
import { busyError } from './busy.ts';
import { appendPositions, columnTypes, insertScope, junctionColumns } from './insert.ts';
import { checkReferences } from './references.ts';
import { checkChildUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

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
 * Uniqueness prechecks exclude the matched rows, so a kept value never collides with its own record.
 * The returned records are all matched rows, untouched empty inputs included, in their final state.
 */
export async function runUpdate(
  collection: string,
  input: Record<string, unknown>,
  condition: ConditionNode,
  joinedTx?: Transaction,
): Promise<UpdateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction(
          (tx) => attemptUpdate(tx, meta, dialect, input, condition),
          'immediate',
        )
    : () => attemptUpdate(joinedTx, meta, dialect, input, condition);
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    if (dialect.isUniqueViolation(error)) return { ok: false, errors: uniqueRaceErrors(meta) };
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
): Promise<UpdateOutcome> {
  const processed = await runRecord(meta, input, { operation: 'update', tx });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;

  const matched = await matchedUUIDs(tx, dialect, meta, condition);
  if (matched.length === 0) return { ok: true, records: [] };

  const uniqueErrors = await checkUnique(tx, dialect, meta, scope.columns, matched);
  if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };

  const excludeChildUUIDs =
    scope.uniqueProbes.length === 0
      ? []
      : await subtreeChildUUIDs(tx, dialect, meta.fields, matched);
  const childUniqueErrors = await checkChildUnique(
    tx,
    dialect,
    scope.uniqueProbes,
    excludeChildUUIDs,
  );
  if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };

  const referenceErrors = await checkReferences(tx, dialect, scope.refs);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const correlationErrors = await checkCorrelation(tx, dialect, matched, scope.children);
  if (!isEmpty(correlationErrors)) return { ok: false, errors: correlationErrors };

  await updateColumns(tx, dialect, meta.table, meta.fields, scope.columns, matched);
  for (const uuid of matched) await applyDerived(tx, dialect, uuid, scope);

  return { ok: true, records: await readMatched(meta.collection, matched) };
}

/**
 * Resolves the `UUID`s a condition matches, compiling the same `WHERE` clause the read path does.
 */
async function matchedUUIDs(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  condition: ConditionNode,
): Promise<string[]> {
  const where = compileWhere(condition, meta, dialect);
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(meta.table)} WHERE ${where.sql}`,
    where.params,
  );
  return rows.map((row) => row.UUID);
}

/**
 * Proves every correlated composite item names an existing row on its parent, keyed at its exact path.
 * A repeater item's `UUID` must belong to the parent it sits under; a UUID matching nothing is an error.
 * Correlation recurses only into rows an update keeps: matched repeater items and an existing object row.
 */
async function checkCorrelation(
  tx: Transaction,
  dialect: Dialect,
  parents: readonly string[],
  children: readonly ProcessedChild[],
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  for (const child of children) {
    const many = child.meta.kind === 'childMany';
    const correlatable = many
      ? child.items.some((item) => !isUndefined(item.itemUUID))
      : (child.items[0]?.children.length ?? 0) > 0;
    if (!correlatable) continue;
    const table = child.meta.table as string;
    for (const parent of parents) {
      const existing = await childUUIDs(tx, dialect, table, parent);
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
            await checkCorrelation(tx, dialect, [uuid], child.items[index].children),
          );
        }
      } else {
        const objectUUID = first([...existing]);
        if (!isUndefined(objectUUID)) {
          Object.assign(
            errors,
            await checkCorrelation(tx, dialect, [objectUUID], child.items[0].children),
          );
        }
      }
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
 */
async function applyDerived(
  tx: Transaction,
  dialect: Dialect,
  uuid: string,
  scope: ProcessedScope,
): Promise<void> {
  for (const relation of scope.relations) await diffJunction(tx, dialect, relation, uuid);
  for (const child of scope.children) await correlateChild(tx, dialect, child, uuid);
}

/**
 * Diffs one `records` field's junction against the input: delete removed, insert added, renumber kept.
 *
 * Added links append their `linkPosition` per target, exactly as a create does.
 * Kept links keep their `linkPosition` - the target's own ordering - and only their `selfPosition` renumbers.
 * An unchanged input issues no writes at all, since every removal, addition, and renumber is empty.
 */
async function diffJunction(
  tx: Transaction,
  dialect: Dialect,
  relation: ProcessedRelation,
  ownerUUID: string,
): Promise<void> {
  const cols = junctionColumns(relation.meta);
  const table = dialect.quote(cols.table);
  const self = dialect.quote(cols.self);
  const link = dialect.quote(cols.link);
  const selfPos = dialect.quote(cols.selfPosition);

  const existing = await tx.query<{ target: string; pos: number }>(
    `SELECT ${link} AS "target", ${selfPos} AS "pos" FROM ${table} WHERE ${self} = ?`,
    [ownerUUID],
  );
  const currentPos = new Map<string, number>(existing.map((row) => [row.target, row.pos]));
  const targets = relation.uuids;
  const inputSet = new Set(targets);

  const removed = existing.map((row) => row.target).filter((target) => !inputSet.has(target));
  for (const batch of chunk(removed, 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(`DELETE FROM ${table} WHERE ${self} = ? AND ${link} IN (${marks})`, [
      ownerUUID,
      ...batch,
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
    );
    const rows: SQLValue[][] = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (currentPos.has(target)) continue;
      const linkPosition = nextByTarget.get(target) ?? 0;
      nextByTarget.set(target, linkPosition + 1);
      rows.push([ownerUUID, target, index, linkPosition]);
    }
    const quoted = [cols.self, cols.link, cols.selfPosition, cols.linkPosition]
      .map((column) => dialect.quote(column))
      .join(', ');
    for (const batch of chunk(rows, 225)) {
      const tuples = batch.map(() => '(?, ?, ?, ?)').join(', ');
      await tx.run(`INSERT INTO ${table} (${quoted}) VALUES ${tuples}`, batch.flat());
    }
  }

  for (let index = 0; index < targets.length; index++) {
    const current = currentPos.get(targets[index]);
    if (isUndefined(current) || current === index) continue;
    await tx.run(`UPDATE ${table} SET ${selfPos} = ? WHERE ${self} = ? AND ${link} = ?`, [
      index,
      ownerUUID,
      targets[index],
    ]);
  }
}

/**
 * Correlates one composite field's items against the existing child rows, updating, inserting, and deleting.
 *
 * A repeater matches by item `UUID`: a match updates, an unmatched row deletes, a new item inserts.
 * An `object` upserts its single row by parent: an empty list clears it, a value sets it.
 * A matched or existing row keeps its identity, so a nested repeater's own items correlate one level down.
 */
async function correlateChild(
  tx: Transaction,
  dialect: Dialect,
  child: ProcessedChild,
  parentUUID: string,
): Promise<void> {
  const table = child.meta.table as string;
  const subfields = child.meta.subfields as Record<string, FieldQueryMeta>;
  const existing = await childUUIDs(tx, dialect, table, parentUUID);

  if (child.meta.kind === 'childOne') {
    const objectUUID = first([...existing]);
    const item = first(child.items);
    if (isUndefined(item)) {
      if (!isUndefined(objectUUID)) await deleteChildren(tx, dialect, table, [objectUUID]);
      return;
    }
    if (isUndefined(objectUUID)) {
      await insertScope(tx, dialect, table, subfields, uuidv7(), item, { uuid: parentUUID });
      return;
    }
    await updateChildRow(tx, dialect, table, subfields, item, objectUUID);
    await applyDerived(tx, dialect, objectUUID, item);
    return;
  }

  const consumed = new Set(child.items.map((item) => item.itemUUID).filter(isString));
  await deleteChildren(
    tx,
    dialect,
    table,
    [...existing].filter((uuid) => !consumed.has(uuid)),
  );
  for (let index = 0; index < child.items.length; index++) {
    const item = child.items[index];
    if (isUndefined(item.itemUUID)) {
      await insertScope(tx, dialect, table, subfields, uuidv7(), item, {
        uuid: parentUUID,
        position: index,
      });
      continue;
    }
    await updateChildRow(tx, dialect, table, subfields, item, item.itemUUID, index);
    await applyDerived(tx, dialect, item.itemUUID, item);
  }
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
 */
async function childUUIDs(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parentUUID: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} WHERE ${dialect.quote('_parentUUID')} = ?`,
    [parentUUID],
  );
  return new Set(rows.map((row) => row.UUID));
}

/**
 * Every existing composite child row under the matched records, at every nesting depth.
 *
 * An update rewrites the whole subtree of a matched record, so the precheck excludes these rows.
 * A kept value then never collides with a row that is itself being rewritten.
 * Resolved only when the write carries a table-wide-unique composite probe, so the common write pays nothing.
 */
async function subtreeChildUUIDs(
  tx: Transaction,
  dialect: Dialect,
  fields: Record<string, FieldQueryMeta>,
  parents: readonly string[],
): Promise<string[]> {
  const all: string[] = [];
  for (const field of Object.values(fields)) {
    if (field.kind !== 'childOne' && field.kind !== 'childMany') continue;
    const rows = await childUUIDsUnder(tx, dialect, field.table as string, parents);
    if (rows.length === 0) continue;
    all.push(...rows);
    all.push(
      ...(await subtreeChildUUIDs(
        tx,
        dialect,
        field.subfields as Record<string, FieldQueryMeta>,
        rows,
      )),
    );
  }
  return all;
}

/**
 * The `UUID`s of one composite table's rows under any of `parents`, chunked for the driver's `IN` limit.
 */
async function childUUIDsUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
): Promise<string[]> {
  const uuids: string[] = [];
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ UUID: string }>(
      `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} IN (${marks})`,
      [...batch],
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
 * Re-reads the matched records in their final state, chunked so a large update stays under the param cap.
 */
async function readMatched(collection: string, matched: readonly string[]): Promise<QueryRecord[]> {
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
    });
    records.push(...rows);
  }
  return records;
}
