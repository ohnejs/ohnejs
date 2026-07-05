import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import {
  readSnapshot,
  schemaHash,
  writeSnapshot,
} from '../../../../src/ohne/database/schema/snapshot.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';

const dialect = new SQLiteDialect();

const UUID = { name: 'UUID', type: 'text', notNull: true } as const;

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

function table(name: string, overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    name,
    columns: [UUID],
    primaryKey: ['UUID'],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

async function lockIsFree(db: DatabaseAdapter): Promise<void> {
  deepStrictEqual(await db.query('SELECT * FROM "ohne_locks"'), []);
}

describe('syncDatabase', () => {
  it('materializes a fresh database and writes generation 1', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: true }],
      indexes: [{ name: 'IX__Posts__title', columns: ['title'] }],
    });
    const report = await syncDatabase(db, dialect, { desired: [posts] });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(await dialect.describeTable(db, 'Posts'), posts);
    const snapshot = await readSnapshot(db, dialect);
    strictEqual(snapshot?.generation, 1);
    strictEqual(snapshot.hash, schemaHash([posts]));
    await lockIsFree(db);
    await db.close();
  });

  it('re-syncs an identical schema as a no-op', async () => {
    const db = await open();
    const posts = table('Posts');
    await syncDatabase(db, dialect, { desired: [posts] });
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    await syncDatabase(db, dialect, { desired: [posts] });
    strictEqual((await readSnapshot(db, dialect))?.generation, 1);
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    await lockIsFree(db);
    await db.close();
  });

  it('bumps the generation and keeps history across an evolution', async () => {
    const db = await open();
    const before = table('Posts');
    const after = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await syncDatabase(db, dialect, { desired: [before] });
    await syncDatabase(db, dialect, { desired: [after] });
    const snapshot = await readSnapshot(db, dialect);
    strictEqual(snapshot?.generation, 2);
    deepStrictEqual(snapshot.history, [{ generation: 1, hash: schemaHash([before]) }]);
    strictEqual((await dialect.describeTable(db, 'Posts')).columns.length, 2);
    await db.close();
  });

  it('writes a snapshot even for an empty desired set', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: [] });
    strictEqual((await readSnapshot(db, dialect))?.generation, 1);
    deepStrictEqual(await dialect.listTables(db), ['ohne_locks', 'ohne_schema']);
    await db.close();
  });

  it('leaves foreign tables untouched, even under force', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Legacy" ("a" TEXT)');
    await db.run('INSERT INTO "Legacy" ("a") VALUES (?)', ['kept']);
    await syncDatabase(db, dialect, { desired: [table('Posts')], force: true });
    strictEqual((await db.query('SELECT * FROM "Legacy"')).length, 1);
    const snapshot = await readSnapshot(db, dialect);
    deepStrictEqual(Object.keys(snapshot?.classification ?? {}), ['Posts']);
    await db.close();
  });

  it('refuses a fresh-database collision with an unowned table', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Posts" ("a" TEXT)');
    await rejects(syncDatabase(db, dialect, { desired: [table('Posts')] }), (error: unknown) => {
      match(String((error as Error).message), /collide/);
      return true;
    });
    await lockIsFree(db);
    await db.close();
  });

  it('refuses to sync a superseded build', async () => {
    const db = await open();
    const posts = table('Posts');
    await syncDatabase(db, dialect, { desired: [] });
    const current = await readSnapshot(db, dialect);
    ok(current);
    await writeSnapshot(db, dialect, {
      generation: 2,
      hash: 'newer',
      history: [{ generation: 1, hash: schemaHash([posts]) }],
      classification: {},
    });
    await rejects(syncDatabase(db, dialect, { desired: [posts] }), /newer than this build/);
    await lockIsFree(db);
    await db.close();
  });

  it('rolls back everything and frees the lock on a guard refusal', async () => {
    const db = await open();
    const posts = table('Posts');
    await syncDatabase(db, dialect, { desired: [posts] });
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    await rejects(syncDatabase(db, dialect, { desired: [] }), /Destructive sync refused/);
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    strictEqual((await readSnapshot(db, dialect))?.generation, 1);
    await lockIsFree(db);
    const report = await syncDatabase(db, dialect, { desired: [], force: true });
    strictEqual(report.deletions.length, 1);
    deepStrictEqual(await dialect.listTables(db), ['ohne_locks', 'ohne_schema']);
    await db.close();
  });

  it('drops a claimed table that left the desired set', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: [table('Posts'), table('Drafts')] });
    await syncDatabase(db, dialect, { desired: [table('Posts')] });
    deepStrictEqual(await dialect.listTables(db), ['Posts', 'ohne_locks', 'ohne_schema']);
    await db.close();
  });

  it('re-adds a hand-dropped index without bumping the generation', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      indexes: [{ name: 'IX__Posts__title', columns: ['title'] }],
    });
    await syncDatabase(db, dialect, { desired: [posts] });
    await db.exec('DROP INDEX "IX__Posts__title"');
    await syncDatabase(db, dialect, { desired: [posts] });
    deepStrictEqual((await dialect.describeTable(db, 'Posts')).indexes, posts.indexes);
    strictEqual((await readSnapshot(db, dialect))?.generation, 1);
    await db.close();
  });

  it('never rebuilds coded primitives on a re-sync', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [
        UUID,
        { name: 'meta', type: 'json', notNull: false },
        { name: 'draft', type: 'boolean', notNull: true },
      ],
    });
    await syncDatabase(db, dialect, { desired: [posts] });
    await db.run('INSERT INTO "Posts" ("UUID", "meta", "draft") VALUES (?, ?, ?)', ['a', '{}', 1]);
    await syncDatabase(db, dialect, { desired: [posts] });
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    strictEqual((await readSnapshot(db, dialect))?.generation, 1);
    await db.close();
  });
});
