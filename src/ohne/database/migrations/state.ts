import type { Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';

import { OHNE_MIGRATIONS } from '../naming/table-names.ts';

/**
 * One migration's persisted outcome, one row in `ohne_migrations`.
 */
export interface MigrationStamp {
  /**
   * The migration's identity: `<layer>/<filename>` without the extension.
   */
  name: string;

  /**
   * How the migration resolved: `applied` ran it, `skipped` found nothing to do.
   * Only an applied migration counts as guard coverage.
   */
  status: 'applied' | 'skipped';

  /**
   * Why the migration skipped.
   * Absent on an applied stamp.
   */
  reason?: string;
}

/**
 * Ensures the `ohne_migrations` table exists, tolerating a concurrent create.
 */
export async function ensureMigrationsTable(db: Transaction, dialect: Dialect): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${dialect.quote(OHNE_MIGRATIONS)} (` +
      `${dialect.quote('name')} ${dialect.columnType('text')} PRIMARY KEY, ` +
      `${dialect.quote('status')} ${dialect.columnType('text')} NOT NULL, ` +
      `${dialect.quote('reason')} ${dialect.columnType('text')}, ` +
      `${dialect.quote('stampedAt')} ${dialect.columnType('integer')} NOT NULL)`,
  );
}

/**
 * Reads the names of every stamped migration, applied and skipped alike.
 * A stamped migration never runs again.
 */
export async function readStampedNames(db: Transaction, dialect: Dialect): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>(
    `SELECT ${dialect.quote('name')} FROM ${dialect.quote(OHNE_MIGRATIONS)}`,
  );
  return new Set(rows.map((row) => row.name));
}

/**
 * Persists one migration's outcome.
 */
export async function stampMigration(
  db: Transaction,
  dialect: Dialect,
  stamp: MigrationStamp,
): Promise<void> {
  await db.run(
    `INSERT INTO ${dialect.quote(OHNE_MIGRATIONS)} (` +
      `${dialect.quote('name')}, ${dialect.quote('status')}, ` +
      `${dialect.quote('reason')}, ${dialect.quote('stampedAt')}) VALUES (?, ?, ?, ?)`,
    [stamp.name, stamp.status, stamp.reason ?? null, Date.now()],
  );
}
