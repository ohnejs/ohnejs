import { createHash } from 'node:crypto';

import type { Transaction } from '../adapter.ts';
import type { Dialect, LogicalType } from '../dialect.ts';
import type { TableSchema } from './table-schema.ts';

import { isUndefined, jsonSerialize } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { OHNE_SCHEMA } from '../naming/table-names.ts';

/**
 * Logical column types per table, keyed table name then column name.
 * Doubles as the claim record: its keys are the tables ohne owns.
 */
export type SchemaClassification = Record<string, Record<string, LogicalType>>;

/**
 * One past schema generation, kept so a rolling deploy's old code is recognizable.
 */
export interface SchemaGeneration {
  /**
   * The generation number the hash belonged to.
   */
  generation: number;

  /**
   * The desired-schema hash of that generation.
   */
  hash: string;
}

/**
 * The persisted schema state: one row in `ohne_schema`, versioned JSON.
 * Live structure stays authoritative; the snapshot carries only what introspection cannot see.
 */
export interface SchemaSnapshot {
  /**
   * The current generation, starting at `1` and bumping only when the schema hash changes.
   */
  generation: number;

  /**
   * The hash of the desired schema this generation realized.
   */
  hash: string;

  /**
   * Past generations, oldest first, capped at 20.
   * The current generation is not listed; finding a hash here means older code wrote it.
   */
  history: readonly SchemaGeneration[];

  /**
   * The classification of every claimed table's columns.
   * Restores `boolean` and `json` over the storage primitives introspection reports.
   */
  classification: SchemaClassification;
}

const HISTORY_LIMIT = 20;

/**
 * Ensures the `ohne_schema` table exists, tolerating a concurrent create.
 */
export async function ensureSchemaTable(db: Transaction, dialect: Dialect): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${dialect.quote(OHNE_SCHEMA)} (` +
      `${dialect.quote('key')} ${dialect.columnType('text')} PRIMARY KEY, ` +
      `${dialect.quote('data')} ${dialect.columnType('text')} NOT NULL)`,
  );
}

/**
 * Reads the snapshot, or `undefined` when no sync has written one.
 */
export async function readSnapshot(
  db: Transaction,
  dialect: Dialect,
): Promise<SchemaSnapshot | undefined> {
  const row = await db.queryOne<{ data: string }>(
    `SELECT ${dialect.quote('data')} FROM ${dialect.quote(OHNE_SCHEMA)} WHERE ${dialect.quote('key')} = ?`,
    ['schema'],
  );
  if (isUndefined(row)) return undefined;
  const { generation, hash, history, classification } = JSON.parse(row.data) as SchemaSnapshot;
  return { generation, hash, history, classification };
}

/**
 * Upserts the one snapshot row.
 */
export async function writeSnapshot(
  db: Transaction,
  dialect: Dialect,
  snapshot: SchemaSnapshot,
): Promise<void> {
  const data = JSON.stringify({ version: 1, ...snapshot });
  await db.run(
    `INSERT INTO ${dialect.quote(OHNE_SCHEMA)} (${dialect.quote('key')}, ${dialect.quote('data')}) ` +
      `VALUES (?, ?) ON CONFLICT (${dialect.quote('key')}) ` +
      `DO UPDATE SET ${dialect.quote('data')} = excluded.${dialect.quote('data')}`,
    ['schema', data],
  );
}

/**
 * Builds the snapshot a sync should persist after realizing `hash`.
 * An unchanged hash keeps the generation and history, refreshing only the classification.
 * A changed hash bumps the generation and appends the previous one to the bounded history.
 */
export function advanceSnapshot(
  previous: SchemaSnapshot | undefined,
  hash: string,
  classification: SchemaClassification,
): SchemaSnapshot {
  if (!isUndefined(previous) && previous.hash === hash) {
    return { ...previous, classification };
  }
  const history = isUndefined(previous)
    ? []
    : [...previous.history, { generation: previous.generation, hash: previous.hash }].slice(
        -HISTORY_LIMIT,
      );
  return { generation: (previous?.generation ?? 0) + 1, hash, history, classification };
}

/**
 * Throws the version-skew refusal when `hash` was already superseded in the snapshot's history.
 * A build whose desired hash sits in the history is old code; syncing would revert the schema.
 */
export function refuseIfSuperseded(snapshot: SchemaSnapshot | undefined, hash: string): void {
  if (isUndefined(snapshot)) return;
  if (!snapshot.history.some((generation) => generation.hash === hash)) return;
  throw ohneError({
    title: 'The database schema is newer than this build',
    body: [
      `Another instance synced the schema past this build; the database is at generation \`${snapshot.generation}\`.`,
      'Deploy the newer build to this instance, or stop the fleet and start it on one version.',
    ],
  });
}

/**
 * Hashes a desired schema deterministically: tables sorted by name, keys sorted by `jsonSerialize`.
 */
export function schemaHash(tables: readonly TableSchema[]): string {
  const sorted = [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(jsonSerialize(sorted)).digest('hex');
}

/**
 * Derives the classification of a desired schema: every table's logical column types.
 */
export function classifySchema(desired: readonly TableSchema[]): SchemaClassification {
  return Object.fromEntries(
    desired.map((table) => [
      table.name,
      Object.fromEntries(table.columns.map((column) => [column.name, column.type])),
    ]),
  );
}

/**
 * Restores logical column types over an introspected schema.
 * A stored type wins only while it shares the introspected type's native column type.
 * A column hand-retyped since the snapshot keeps what the database reports.
 */
export function applyClassification(
  live: readonly TableSchema[],
  classification: SchemaClassification,
  dialect: Dialect,
): TableSchema[] {
  return live.map((table) => {
    const columns = classification[table.name];
    if (isUndefined(columns)) return table;
    return {
      ...table,
      columns: table.columns.map((column) => {
        const stored = columns[column.name];
        if (isUndefined(stored)) return column;
        if (dialect.columnType(stored) !== dialect.columnType(column.type)) return column;
        return { ...column, type: stored };
      }),
    };
  });
}
