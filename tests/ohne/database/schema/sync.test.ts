import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { readSnapshot, schemaHash } from '../../../../src/ohne/database/schema/snapshot.ts';
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

function meta(name: string, migration: Migration): MigrationMeta {
  return { name, migration, file: `/app/migrations/${name.split('/')[1]}.ts` };
}

function stampedRows(db: DatabaseAdapter): Promise<{ name: string; status: string }[]> {
  return db.query('SELECT "name", "status" FROM "ohne_migrations" ORDER BY "name"');
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

  it('bumps the generation across an evolution', async () => {
    const db = await open();
    const before = table('Posts');
    const after = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await syncDatabase(db, dialect, { desired: [before] });
    await syncDatabase(db, dialect, { desired: [after] });
    const snapshot = await readSnapshot(db, dialect);
    strictEqual(snapshot?.generation, 2);
    strictEqual(snapshot.hash, schemaHash([after]));
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

  it('refuses a collision differing only in case', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "posts" ("a" TEXT)');
    await rejects(syncDatabase(db, dialect, { desired: [table('Posts')] }), /collide/);
    strictEqual((await db.query('SELECT * FROM "posts"')).length, 0);
    await lockIsFree(db);
    await db.close();
  });

  it('syncs a previously-seen shape forward', async () => {
    const db = await open();
    const before = table('Posts');
    const after = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await syncDatabase(db, dialect, { desired: [before] });
    await syncDatabase(db, dialect, { desired: [after] });
    const report = await syncDatabase(db, dialect, { desired: [before] });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    const snapshot = await readSnapshot(db, dialect);
    strictEqual(snapshot?.generation, 3);
    strictEqual(snapshot.hash, schemaHash([before]));
    deepStrictEqual(await dialect.describeTable(db, 'Posts'), before);
    await lockIsFree(db);
    await db.close();
  });

  it('rolls back a populated change through a migration', async () => {
    const db = await open();
    const before = table('Posts');
    const after = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await syncDatabase(db, dialect, { desired: [before] });
    await syncDatabase(db, dialect, { desired: [after] });
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?)', ['a', 'unwanted']);
    await rejects(syncDatabase(db, dialect, { desired: [before] }), /Destructive sync refused/);
    const migrations = [
      meta('app/001-drop-title', {
        from: { table: 'Posts', column: 'title', type: 'text' },
        to: null,
      }),
    ];
    const report = await syncDatabase(db, dialect, { desired: [before], migrations });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(await dialect.describeTable(db, 'Posts'), before);
    const snapshot = await readSnapshot(db, dialect);
    strictEqual(snapshot?.hash, schemaHash([before]));
    deepStrictEqual(
      (await stampedRows(db)).map((row) => [row.name, row.status]),
      [['app/001-drop-title', 'applied']],
    );
    const again = await syncDatabase(db, dialect, { desired: [before], migrations });
    deepStrictEqual(again, { deletions: [], warnings: [] });
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

  describe('migrations', () => {
    it('runs a move inside the sync, constraints down and re-added after', async () => {
      const db = await open();
      const before = table('Posts', {
        columns: [UUID, { name: 'isDraft', type: 'text', notNull: false }],
        indexes: [{ name: 'IX__Posts__isDraft', columns: ['isDraft'] }],
      });
      await syncDatabase(db, dialect, { desired: [before] });
      await db.run('INSERT INTO "Posts" ("UUID", "isDraft") VALUES (?, ?), (?, ?)', [
        'a',
        'yes',
        'b',
        'no',
      ]);
      const after = table('Posts', {
        columns: [UUID, { name: 'draft', type: 'boolean', notNull: true }],
        indexes: [{ name: 'IX__Posts__draft', columns: ['draft'] }],
      });
      const report = await syncDatabase(db, dialect, {
        desired: [after],
        migrations: [
          meta('app/001-draft', {
            from: { table: 'Posts', column: 'isDraft', type: 'text' },
            to: { table: 'Posts', column: 'draft', type: 'boolean' },
            transform: (value) => value === 'yes',
          }),
        ],
      });
      deepStrictEqual(report, { deletions: [], warnings: [] });
      deepStrictEqual(await dialect.describeTable(db, 'Posts'), {
        ...after,
        columns: [UUID, { name: 'draft', type: 'integer', notNull: true }],
      });
      const rows = await db.query<{ UUID: string; draft: number }>(
        'SELECT "UUID", "draft" FROM "Posts" ORDER BY "UUID"',
      );
      deepStrictEqual(
        rows.map((row) => [row.UUID, row.draft]),
        [
          ['a', 1],
          ['b', 0],
        ],
      );
      deepStrictEqual(await stampedRows(db), [
        Object.assign(Object.create(null), { name: 'app/001-draft', status: 'applied' }),
      ]);
      await lockIsFree(db);
      await db.close();
    });

    it('never re-runs a stamped migration', async () => {
      const db = await open();
      const posts = table('Posts', {
        columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
      });
      await syncDatabase(db, dialect, { desired: [posts] });
      const migrations = [
        meta('app/001-drop', {
          from: { table: 'Posts', column: 'legacy', type: 'text' },
          to: null,
        }),
      ];
      const bare = table('Posts');
      await syncDatabase(db, dialect, { desired: [bare], migrations });
      await syncDatabase(db, dialect, { desired: [bare], migrations });
      strictEqual((await stampedRows(db)).length, 1);
      await lockIsFree(db);
      await db.close();
    });

    it('lets a discard migration cover a populated drop the guard would refuse', async () => {
      const db = await open();
      const posts = table('Posts', {
        columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
      });
      await syncDatabase(db, dialect, { desired: [posts] });
      await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['a', 'x']);
      const bare = table('Posts');
      await rejects(syncDatabase(db, dialect, { desired: [bare] }), /Destructive sync refused/);
      const report = await syncDatabase(db, dialect, {
        desired: [bare],
        migrations: [
          meta('app/001-drop', {
            from: { table: 'Posts', column: 'legacy', type: 'text' },
            to: null,
          }),
        ],
      });
      deepStrictEqual(report, { deletions: [], warnings: [] });
      deepStrictEqual(await dialect.describeTable(db, 'Posts'), bare);
      await db.close();
    });

    it('renames a table and recreates its constraints under the new name', async () => {
      const db = await open();
      const posts = table('Posts', {
        columns: [UUID, { name: 'email', type: 'text', notNull: false }],
        uniques: [{ name: 'UX__Posts__email', columns: ['email'] }],
      });
      await syncDatabase(db, dialect, { desired: [posts] });
      await db.run('INSERT INTO "Posts" ("UUID", "email") VALUES (?, ?)', ['a', 'a@b.c']);
      const articles = table('Articles', {
        columns: [UUID, { name: 'email', type: 'text', notNull: false }],
        uniques: [{ name: 'UX__Articles__email', columns: ['email'] }],
      });
      await syncDatabase(db, dialect, {
        desired: [articles],
        migrations: [
          meta('app/001-articles', { from: { table: 'Posts' }, to: { table: 'Articles' } }),
        ],
      });
      const names = await dialect.listTables(db);
      ok(names.includes('Articles'));
      ok(!names.includes('Posts'));
      deepStrictEqual(await dialect.describeTable(db, 'Articles'), articles);
      strictEqual((await db.query('SELECT * FROM "Articles"')).length, 1);
      await db.close();
    });

    it('rolls back an applied migration and its stamp on a later refusal', async () => {
      const db = await open();
      const posts = table('Posts', {
        columns: [
          UUID,
          { name: 'legacy', type: 'text', notNull: false },
          { name: 'doomed', type: 'text', notNull: false },
        ],
      });
      await syncDatabase(db, dialect, { desired: [posts] });
      await db.run('INSERT INTO "Posts" ("UUID", "legacy", "doomed") VALUES (?, ?, ?)', [
        'a',
        'keep',
        'gone',
      ]);
      await rejects(
        syncDatabase(db, dialect, {
          desired: [table('Posts')],
          migrations: [
            meta('app/001-doomed', {
              from: { table: 'Posts', column: 'doomed', type: 'text' },
              to: null,
            }),
          ],
        }),
        /Destructive sync refused/,
      );
      deepStrictEqual(
        (await dialect.describeTable(db, 'Posts')).columns.map((column) => column.name),
        ['UUID', 'legacy', 'doomed'],
      );
      deepStrictEqual(await stampedRows(db), []);
      strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
      await lockIsFree(db);
      await db.close();
    });

    it('reports the values a forced move dropped', async () => {
      const db = await open();
      const posts = table('Posts', {
        columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      });
      const archive = table('Archive', {
        columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      });
      await syncDatabase(db, dialect, { desired: [posts, archive] });
      await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?), (?, ?)', [
        'a',
        'kept',
        'b',
        'lost',
      ]);
      await db.run('INSERT INTO "Archive" ("UUID") VALUES (?)', ['a']);
      const migrations = [
        meta('app/001-archive', {
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Archive', column: 'title', type: 'text' },
        }),
      ];
      const desired = [table('Posts'), archive];
      await rejects(syncDatabase(db, dialect, { desired, migrations }), /cannot map every row/);
      const report = await syncDatabase(db, dialect, { desired, migrations, force: true });
      strictEqual(report.deletions.length, 1);
      match(report.deletions[0] ?? '', /`1` `Posts.title` values/);
      deepStrictEqual(await dialect.describeTable(db, 'Posts'), table('Posts'));
      await db.close();
    });
  });
});
