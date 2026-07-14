import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';
import type { QueryRecord } from '../read/find.ts';
import type { FieldErrors } from './errors.ts';

import { chunk, isEmpty, isUndefined, uniqueArray, uuidv7 } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { queryMetadata } from '../metadata.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { readRows } from '../read/find.ts';
import { busyError } from './busy.ts';
import { checkReferences } from './references.ts';
import { checkChildUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

/**
 * The outcome of a create: the re-read record, or the field failures that stopped it.
 */
export type CreateOutcome = { ok: true; record: QueryRecord } | { ok: false; errors: FieldErrors };

/**
 * Creates one record and returns it, or the field failures.
 *
 * Runs the whole in-transaction order: validate, precheck uniqueness, prove references, insert, re-read.
 * Opens an `immediate` write transaction unless `joinedTx` supplies one, in which case the caller holds it.
 * A validation or precheck failure returns `{ ok: false }` and writes nothing.
 * A constraint race is classified; a busy database surfaces as a retryable `busyError`, an HTTP `503`.
 */
export async function runCreate(
  collection: string,
  input: Record<string, unknown>,
  joinedTx?: Transaction,
): Promise<CreateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const run = isUndefined(joinedTx)
    ? () => useDatabase().transaction((tx) => attemptCreate(tx, meta, dialect, input), 'immediate')
    : () => attemptCreate(joinedTx, meta, dialect, input);
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    if (dialect.isUniqueViolation(error)) {
      return { ok: false, errors: uniqueRaceErrors(meta) };
    }
    if (dialect.isForeignKeyViolation(error)) {
      return { ok: false, errors: { '': 'validation.invalidReference' } };
    }
    throw error;
  }
}

/**
 * The insert attempt inside the transaction, ordered exactly as the plan pins.
 */
async function attemptCreate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  input: Record<string, unknown>,
): Promise<CreateOutcome> {
  const processed = await runRecord(meta, input, { operation: 'create', tx });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;

  const uniqueErrors = await checkUnique(tx, dialect, meta, scope.columns);
  if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };

  const childUniqueErrors = await checkChildUnique(tx, dialect, scope.uniqueProbes);
  if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };

  const referenceErrors = await checkReferences(tx, dialect, scope.refs);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const uuid = uuidv7();
  await insertScope(tx, dialect, meta.table, meta.fields, uuid, scope);

  const rows = await readRows({
    collection: meta.collection,
    condition: { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false },
    select: null,
    order: [],
    limit: 1,
    offset: null,
    populate: [],
  });
  const record = rows[0];
  if (isUndefined(record)) {
    throw ohneError({
      title: `Read-back of a created \`${meta.collection}\` record found nothing`,
      body: [
        'The row was inserted, but reading it back returned no record.',
        'The read path is likely on a different connection than the write transaction.',
      ],
    });
  }
  return { ok: true, record };
}

/**
 * Inserts one scope's main row, then its junction links and child items, recursing into each.
 */
async function insertScope(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  uuid: string,
  scope: ProcessedScope,
  parent?: { uuid: string; position?: number },
): Promise<void> {
  const columns: string[] = ['UUID'];
  const values: SQLValue[] = [uuid];
  if (parent) {
    columns.push('_parentUUID');
    values.push(parent.uuid);
    if (!isUndefined(parent.position)) {
      columns.push('_parentPosition');
      values.push(parent.position);
    }
  } else {
    columns.push('_updatedAt');
    values.push(Date.now());
  }
  const columnType = columnTypes(fields);
  for (const [column, value] of Object.entries(scope.columns)) {
    columns.push(column);
    values.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  const marks = columns.map(() => '?').join(', ');
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  await tx.run(`INSERT INTO ${dialect.quote(table)} (${quoted}) VALUES (${marks})`, values);

  for (const relation of scope.relations) await insertJunction(tx, dialect, relation, uuid);

  for (const child of scope.children) {
    const position = child.meta.kind === 'childMany';
    const childTable = child.meta.table as string;
    const childFields = child.meta.subfields as Record<string, FieldQueryMeta>;
    for (let index = 0; index < child.items.length; index++) {
      await insertScope(tx, dialect, childTable, childFields, uuidv7(), child.items[index], {
        uuid,
        position: position ? index : undefined,
      });
    }
  }
}

/**
 * Inserts one `records` field's junction rows, appending each target's position after its existing links.
 * The owner side writes `_parentPosition` in input order; the inverse side swaps every role.
 */
async function insertJunction(
  tx: Transaction,
  dialect: Dialect,
  relation: ProcessedRelation,
  ownerUUID: string,
): Promise<void> {
  if (relation.uuids.length === 0) return;
  const inverse = relation.meta.inverse === true;
  const table = relation.meta.table as string;
  const selfColumn = inverse ? '_targetUUID' : '_parentUUID';
  const linkColumn = inverse ? '_parentUUID' : '_targetUUID';
  const selfPosition = inverse ? '_targetPosition' : '_parentPosition';
  const linkPosition = inverse ? '_parentPosition' : '_targetPosition';

  const nextByTarget = await appendPositions(
    tx,
    dialect,
    table,
    linkColumn,
    linkPosition,
    relation.uuids,
  );
  const rows = relation.uuids.map((target, index) => {
    const position = nextByTarget.get(target) ?? 0;
    nextByTarget.set(target, position + 1);
    return [ownerUUID, target, index, position] as SQLValue[];
  });

  const quoted = [selfColumn, linkColumn, selfPosition, linkPosition]
    .map((column) => dialect.quote(column))
    .join(', ');
  for (const batch of chunk(rows, 225)) {
    const tuples = batch.map(() => '(?, ?, ?, ?)').join(', ');
    await tx.run(`INSERT INTO ${dialect.quote(table)} (${quoted}) VALUES ${tuples}`, batch.flat());
  }
}

/**
 * The next position to append at, per target, one past that target's current maximum in the junction.
 */
async function appendPositions(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  linkColumn: string,
  linkPosition: string,
  targets: readonly string[],
): Promise<Map<string, number>> {
  const next = new Map<string, number>();
  const column = dialect.quote(linkColumn);
  for (const batch of chunk(uniqueArray(targets), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ target: string; max: number | null }>(
      `SELECT ${column} AS "target", MAX(${dialect.quote(linkPosition)}) AS "max" ` +
        `FROM ${dialect.quote(table)} WHERE ${column} IN (${marks}) GROUP BY ${column}`,
      batch,
    );
    for (const row of rows) next.set(row.target, (row.max ?? -1) + 1);
  }
  return next;
}

/**
 * Maps each column name to its storage primitive, for the bind-time codec.
 */
function columnTypes(fields: Record<string, FieldQueryMeta>): Map<string, LogicalType> {
  const map = new Map<string, LogicalType>();
  for (const field of Object.values(fields)) {
    if (field.column && field.logicalType) map.set(field.column, field.logicalType);
  }
  return map;
}
