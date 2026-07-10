import { createHash } from 'node:crypto';

import type { Transaction } from '../adapter.ts';
import type { Dialect, LogicalType } from '../dialect.ts';
import type { DerivedOrigin, TableSchema } from './table-schema.ts';

import { isUndefined, jsonSerialize, mapValues } from '../../../utils/index.ts';
import { OHNE_SCHEMA } from '../naming/table-names.ts';

/**
 * What the snapshot knows about one claimed table beyond what introspection can see.
 */
export interface TableClaim {
  /**
   * The logical column types, keyed by column name.
   */
  columns: Record<string, LogicalType>;

  /**
   * The derivation origin of a junction or child table; absent on collection main tables.
   */
  derived?: DerivedOrigin;
}

/**
 * One claim per table ohne owns, keyed by physical table name.
 * The keys double as the claim record; an unclaimed live table is foreign.
 */
export type SchemaClassification = Record<string, TableClaim>;

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
   * The classification of every claimed table's columns.
   * Restores `boolean` and `json` over the storage primitives introspection reports.
   */
  classification: SchemaClassification;
}

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
 * A version-1 snapshot stored each claim as a bare column map; reading lifts it into a `TableClaim`.
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
  const parsed = JSON.parse(row.data) as SchemaSnapshot & { version: number };
  const { generation, hash } = parsed;
  const classification =
    parsed.version === 1
      ? mapValues(
          parsed.classification as unknown as Record<string, Record<string, LogicalType>>,
          (_, columns): TableClaim => ({ columns }),
        )
      : parsed.classification;
  return { generation, hash, classification };
}

/**
 * Upserts the one snapshot row.
 */
export async function writeSnapshot(
  db: Transaction,
  dialect: Dialect,
  snapshot: SchemaSnapshot,
): Promise<void> {
  const data = JSON.stringify({ version: 2, ...snapshot });
  await db.run(
    `INSERT INTO ${dialect.quote(OHNE_SCHEMA)} (${dialect.quote('key')}, ${dialect.quote('data')}) ` +
      `VALUES (?, ?) ON CONFLICT (${dialect.quote('key')}) ` +
      `DO UPDATE SET ${dialect.quote('data')} = excluded.${dialect.quote('data')}`,
    ['schema', data],
  );
}

/**
 * Builds the snapshot a sync should persist after realizing `hash`.
 * An unchanged hash keeps the generation, refreshing only the classification.
 * A changed hash bumps the generation.
 */
export function advanceSnapshot(
  previous: SchemaSnapshot | undefined,
  hash: string,
  classification: SchemaClassification,
): SchemaSnapshot {
  if (!isUndefined(previous) && previous.hash === hash) {
    return { ...previous, classification };
  }
  return { generation: (previous?.generation ?? 0) + 1, hash, classification };
}

/**
 * Hashes a desired schema deterministically: tables sorted by name, keys sorted by `jsonSerialize`.
 */
export function schemaHash(tables: readonly TableSchema[]): string {
  const sorted = [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(jsonSerialize(sorted)).digest('hex');
}

/**
 * Derives the classification of a desired schema: each table's logical column types and origin.
 */
export function classifySchema(desired: readonly TableSchema[]): SchemaClassification {
  return Object.fromEntries(
    desired.map((table) => {
      const columns = Object.fromEntries(table.columns.map((column) => [column.name, column.type]));
      return [
        table.name,
        isUndefined(table.derived) ? { columns } : { columns, derived: table.derived },
      ];
    }),
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
    const claim = classification[table.name];
    if (isUndefined(claim)) return table;
    return {
      ...table,
      columns: table.columns.map((column) => {
        const stored = claim.columns[column.name];
        if (isUndefined(stored)) return column;
        if (dialect.columnType(stored) !== dialect.columnType(column.type)) return column;
        return { ...column, type: stored };
      }),
    };
  });
}
