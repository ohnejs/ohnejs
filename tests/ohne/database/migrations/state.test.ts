import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import {
  ensureMigrationsTable,
  readStampedNames,
  stampMigration,
} from '../../../../src/ohne/database/migrations/state.ts';

const dialect = new SQLiteDialect();

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

describe('migration state', () => {
  it('ensures the table idempotently', async () => {
    const db = await open();
    await ensureMigrationsTable(db, dialect);
    await ensureMigrationsTable(db, dialect);
    deepStrictEqual(await readStampedNames(db, dialect), new Set());
    await db.close();
  });

  it('round-trips applied and skipped stamps', async () => {
    const db = await open();
    await ensureMigrationsTable(db, dialect);
    await stampMigration(db, dialect, { name: 'app/001-move', status: 'applied' });
    await stampMigration(db, dialect, {
      name: 'app/002-rename',
      status: 'skipped',
      reason: '`Posts` is absent and `Articles` is satisfied',
    });
    deepStrictEqual(
      await readStampedNames(db, dialect),
      new Set(['app/001-move', 'app/002-rename']),
    );
    const rows = await db.query<{ name: string; status: string; reason: string | null }>(
      'SELECT "name", "status", "reason" FROM "ohne_migrations" ORDER BY "name"',
    );
    strictEqual(rows[0]?.status, 'applied');
    strictEqual(rows[0]?.reason, null);
    strictEqual(rows[1]?.status, 'skipped');
    strictEqual(rows[1]?.reason, '`Posts` is absent and `Articles` is satisfied');
    await db.close();
  });
});
