import type { DatabaseAdapter, Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type { MigrationMeta } from '../migrations/use-migrations.ts';
import type { GuardReport } from './guard.ts';
import type { TableDiff, TableSchema } from './table-schema.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { executeMigrations } from '../migrations/execute.ts';
import { ensureMigrationsTable, readStampedNames, stampMigration } from '../migrations/state.ts';
import { OHNE_LOCKS, OHNE_MIGRATIONS, OHNE_SCHEMA } from '../naming/table-names.ts';
import { diffSchemas } from './diff.ts';
import { guardDiffs } from './guard.ts';
import { acquireSyncLock } from './lock.ts';
import {
  advanceSnapshot,
  applyClassification,
  classifySchema,
  readSnapshot,
  schemaHash,
  writeSnapshot,
} from './snapshot.ts';

/**
 * One sync run's inputs.
 */
export interface SyncOptions {
  /**
   * The tables the running code wants live.
   */
  desired: readonly TableSchema[];

  /**
   * The registered migrations in execution order; those not yet stamped run inside this sync.
   *
   * @default
   * []
   */
  migrations?: readonly MigrationMeta[];

  /**
   * Authorizes destructive findings and performs the purges they report.
   *
   * @default
   * false
   */
  force?: boolean;

  /**
   * Milliseconds between polls of a held sync lock.
   *
   * @default
   * 250
   */
  pollInterval?: number;

  /**
   * Milliseconds after which a held sync lock counts as abandoned.
   *
   * @default
   * 60_000
   */
  staleAfter?: number;
}

const INTERNAL_TABLES = new Set<string>([OHNE_LOCKS, OHNE_MIGRATIONS, OHNE_SCHEMA]);

/**
 * Reconciles the live database with the desired schema, cluster-safe and all-or-nothing.
 *
 * The winner of the sync lock sweeps rebuild leftovers, reads the snapshot, and introspects.
 * Live structure is authoritative; the snapshot supplies classification and the claim record.
 * Unclaimed tables are foreign: never dropped, and a name collision with the desired set refuses.
 * Collisions match case-insensitively - the weakest dialect's rule, so schemas stay portable.
 *
 * Pending migrations run inside the transaction, before the structural diff.
 * Uniques and indexes drop first on every touched table, so migrations write under no constraint.
 * The diff then runs against the migrated structure and re-adds them, each add probed by the guard.
 * Migration stamps persist in the same transaction; a refusal rolls them back with everything else.
 *
 * Bracket, migrations, diff, guard, apply, snapshot write, stamps, and lock release are one transaction.
 * On failure everything rolls back, the lock frees best-effort, and the boot dies with the thrown error.
 * A loser instance returns an empty report once the winner realized the same hash.
 */
export async function syncDatabase(
  db: DatabaseAdapter,
  dialect: Dialect,
  options: SyncOptions,
): Promise<GuardReport> {
  const desired = options.desired;
  const desiredHash = schemaHash(desired);
  const handle = await acquireSyncLock(db, dialect, {
    desiredHash,
    pollInterval: options.pollInterval,
    staleAfter: options.staleAfter,
  });
  if (isUndefined(handle)) return { deletions: [], warnings: [] };
  try {
    await dialect.sweepRebuilds(db);
    const snapshot = await readSnapshot(db, dialect);
    const migrations = options.migrations ?? [];
    let pending: MigrationMeta[] = [];
    if (migrations.length > 0) {
      await ensureMigrationsTable(db, dialect);
      const stamped = await readStampedNames(db, dialect);
      pending = migrations.filter((meta) => !stamped.has(meta.name));
    }
    const names = await dialect.listTables(db);
    const claimed = snapshot?.classification ?? {};
    const desiredNames = new Set(desired.map((table) => table.name.toLowerCase()));
    const external = names.filter(
      (name) => !INTERNAL_TABLES.has(name) && isUndefined(claimed[name]),
    );
    const collisions = external.filter((name) => desiredNames.has(name.toLowerCase()));
    if (collisions.length > 0) {
      throw ohneError({
        title: 'Existing tables collide with the desired schema',
        body: [
          'These tables exist but ohne does not own them:',
          '',
          ...collisions.map((name) => `- \`${name}\``),
          '',
          'Rename the colliding collections, or move the tables out of the database.',
        ],
      });
    }
    const live: TableSchema[] = [];
    for (const name of names) {
      if (INTERNAL_TABLES.has(name) || isUndefined(claimed[name])) continue;
      live.push(await dialect.describeTable(db, name));
    }
    const classified = applyClassification(live, claimed, dialect);
    const touched = touchedTables(diffSchemas(classified, desired, dialect), pending);
    const force = options.force ?? false;
    return await dialect.schemaTransaction(db, async (tx) => {
      for (const table of classified) {
        if (touched.has(table.name)) await dropConstraints(tx, dialect, table);
      }
      const outcome = await executeMigrations(tx, dialect, {
        migrations: pending,
        desired,
        claimed,
        force,
      });
      const migrated: TableSchema[] = [];
      for (const name of await dialect.listTables(tx)) {
        if (INTERNAL_TABLES.has(name) || isUndefined(outcome.claimed[name])) continue;
        migrated.push(await dialect.describeTable(tx, name));
      }
      const current = applyClassification(migrated, outcome.claimed, dialect);
      const diffs = diffSchemas(current, desired, dialect);
      const report = await guardDiffs(tx, dialect, diffs, current, { force });
      for (const diff of diffs) {
        await dialect.applyTableDiff(tx, diff);
      }
      await writeSnapshot(
        tx,
        dialect,
        advanceSnapshot(snapshot, desiredHash, classifySchema(desired)),
      );
      for (const stamp of outcome.stamps) {
        await stampMigration(tx, dialect, stamp);
      }
      await dialect.releaseLock(tx, handle);
      return {
        deletions: [...outcome.deletions, ...report.deletions],
        warnings: report.warnings,
      };
    });
  } catch (error) {
    await dialect.releaseLock(db, handle).catch(() => undefined);
    throw error;
  }
}

/**
 * Collects the tables whose constraints come down before migrations run.
 * Over-approximation is safe: every table differing pre-migration, plus every migration FROM and TO.
 */
function touchedTables(
  diffs: readonly TableDiff[],
  pending: readonly MigrationMeta[],
): Set<string> {
  const touched = new Set<string>();
  for (const diff of diffs) {
    touched.add(diff.kind === 'alter' ? diff.desired.name : diff.table.name);
  }
  for (const { migration } of pending) {
    touched.add(migration.from.table);
    if (!isNull(migration.to)) touched.add(migration.to.table);
  }
  return touched;
}

/**
 * Drops every unique and index on `table`, leaving data and foreign keys in place.
 * Migrations then write without tripping transient unique states, and column drops go in place.
 * The diff that follows re-adds the desired set, each add probed by the guard first.
 */
async function dropConstraints(
  db: Transaction,
  dialect: Dialect,
  table: TableSchema,
): Promise<void> {
  if (table.uniques.length === 0 && table.indexes.length === 0) return;
  await dialect.applyTableDiff(db, {
    kind: 'alter',
    live: table,
    desired: { ...table, uniques: [], indexes: [] },
    addColumns: [],
    dropColumns: [],
    changeColumns: [],
    changePrimaryKey: false,
    addUniques: [],
    dropUniques: table.uniques,
    addIndexes: [],
    dropIndexes: table.indexes,
    addForeignKeys: [],
    dropForeignKeys: [],
  });
}
