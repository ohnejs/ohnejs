import type { DatabaseAdapter } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type { GuardReport } from './guard.ts';
import type { TableSchema } from './table-schema.ts';

import { isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { OHNE_LOCKS, OHNE_SCHEMA } from '../naming/table-names.ts';
import { diffSchemas } from './diff.ts';
import { guardDiffs } from './guard.ts';
import { acquireSyncLock } from './lock.ts';
import {
  advanceSnapshot,
  applyClassification,
  classifySchema,
  readSnapshot,
  refuseIfSuperseded,
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

const INTERNAL_TABLES = new Set<string>([OHNE_LOCKS, OHNE_SCHEMA]);

/**
 * Reconciles the live database with the desired schema, cluster-safe and all-or-nothing.
 *
 * The winner of the sync lock sweeps rebuild leftovers, reads the snapshot, and introspects.
 * Live structure is authoritative; the snapshot supplies classification and the claim record.
 * Unclaimed tables are foreign: never dropped, and a name collision with the desired set refuses.
 * Collisions match case-insensitively - the weakest dialect's rule, so schemas stay portable.
 * A build whose hash sits in the snapshot history refuses instead of reverting the schema.
 * Diff, guard, apply, snapshot write, and lock release run in one transaction; COMMIT frees the cluster.
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
    refuseIfSuperseded(snapshot, desiredHash);
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
    const diffs = diffSchemas(classified, desired, dialect);
    return await dialect.schemaTransaction(db, async (tx) => {
      const report = await guardDiffs(tx, dialect, diffs, classified, {
        force: options.force ?? false,
      });
      for (const diff of diffs) {
        await dialect.applyTableDiff(tx, diff);
      }
      await writeSnapshot(
        tx,
        dialect,
        advanceSnapshot(snapshot, desiredHash, classifySchema(desired)),
      );
      await dialect.releaseLock(tx, handle);
      return report;
    });
  } catch (error) {
    await dialect.releaseLock(db, handle).catch(() => undefined);
    throw error;
  }
}
