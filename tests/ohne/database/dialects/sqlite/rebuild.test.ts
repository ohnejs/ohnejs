import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../../src/ohne/database/adapter.ts';
import type { TableSchema } from '../../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { sweepRebuilds } from '../../../../../src/ohne/database/dialects/sqlite/rebuild.ts';
import { diffSchemas } from '../../../../../src/ohne/database/schema/diff.ts';

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

async function apply(
  db: DatabaseAdapter,
  live: TableSchema[],
  desired: TableSchema[],
): Promise<void> {
  await dialect.schemaTransaction(db, async (tx) => {
    for (const diff of diffSchemas(live, desired, dialect)) {
      await dialect.applyTableDiff(tx, diff);
    }
  });
}

async function noAsideRemains(db: DatabaseAdapter): Promise<void> {
  ok(!(await dialect.listTables(db)).some((name) => name.startsWith('ohne_rebuild_')));
}

describe('applyTableDiff', () => {
  it('creates a table that introspects back to its desired shape', async () => {
    const db = await open();
    const desired = table('Posts', {
      columns: [
        UUID,
        { name: 'slug', type: 'text', notNull: true },
        { name: 'author', type: 'text', notNull: false },
        { name: 'views', type: 'integer', notNull: false },
      ],
      uniques: [{ name: 'UX__Posts__slug', columns: ['slug'] }],
      indexes: [{ name: 'IX__Posts__author', columns: ['author'] }],
      foreignKeys: [
        { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
      ],
    });
    await apply(db, [], [table('Users'), desired]);
    deepStrictEqual(await dialect.describeTable(db, 'Posts'), desired);
    await db.close();
  });

  it('reaches a fixed point: coded primitives never re-diff', async () => {
    const db = await open();
    const desired = table('T', {
      columns: [
        UUID,
        { name: 'meta', type: 'json', notNull: false },
        { name: 'draft', type: 'boolean', notNull: true },
      ],
    });
    await apply(db, [], [desired]);
    const live = await dialect.describeTable(db, 'T');
    deepStrictEqual(diffSchemas([live], [desired], dialect), []);
    await db.close();
  });

  it('drops a table', async () => {
    const db = await open();
    await apply(db, [], [table('Legacy')]);
    await apply(db, [table('Legacy')], []);
    deepStrictEqual(await dialect.listTables(db), []);
    await db.close();
  });

  it('adds a nullable column in place, rows intact', async () => {
    const db = await open();
    const live = table('T');
    await apply(db, [], [live]);
    await db.run('INSERT INTO "T" ("UUID") VALUES (?)', ['a']);
    const desired = table('T', { columns: [UUID, { name: 'note', type: 'text', notNull: false }] });
    await apply(db, [live], [desired]);
    deepStrictEqual(await db.query('SELECT * FROM "T"'), [
      Object.assign(Object.create(null), { UUID: 'a', note: null }),
    ]);
    await db.close();
  });

  it('drops a column together with its index in place', async () => {
    const db = await open();
    const live = table('T', {
      columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
      indexes: [{ name: 'IX__T__legacy', columns: ['legacy'] }],
    });
    await apply(db, [], [live]);
    await db.run('INSERT INTO "T" ("UUID", "legacy") VALUES (?, ?)', ['a', 'x']);
    await apply(db, [live], [table('T')]);
    const schema = await dialect.describeTable(db, 'T');
    deepStrictEqual(schema.columns, [UUID]);
    deepStrictEqual(schema.indexes, []);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "T"'), [
      Object.assign(Object.create(null), { UUID: 'a' }),
    ]);
    await db.close();
  });

  it('adds a unique as a separate unique index in place', async () => {
    const db = await open();
    const live = table('T', { columns: [UUID, { name: 'email', type: 'text', notNull: false }] });
    await apply(db, [], [live]);
    const desired = { ...live, uniques: [{ name: 'UX__T__email', columns: ['email'] }] };
    await apply(db, [live], [desired]);
    deepStrictEqual((await dialect.describeTable(db, 'T')).uniques, desired.uniques);
    await db.run('INSERT INTO "T" ("UUID", "email") VALUES (?, ?)', ['a', 'x']);
    await rejects(
      db.run('INSERT INTO "T" ("UUID", "email") VALUES (?, ?)', ['b', 'x']),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    await db.close();
  });

  it('rebuilds on a retype, excluding the retyped column from the copy', async () => {
    const db = await open();
    const live = table('T', { columns: [UUID, { name: 'count', type: 'text', notNull: false }] });
    await apply(db, [], [live]);
    await db.run('INSERT INTO "T" ("UUID", "count") VALUES (?, ?)', ['a', '42']);
    const desired = table('T', {
      columns: [UUID, { name: 'count', type: 'integer', notNull: false }],
    });
    await apply(db, [live], [desired]);
    deepStrictEqual(await db.query('SELECT * FROM "T"'), [
      Object.assign(Object.create(null), { UUID: 'a', count: null }),
    ]);
    strictEqual((await dialect.describeTable(db, 'T')).columns[1]?.type, 'integer');
    await noAsideRemains(db);
    await db.close();
  });

  it('carries values through a notNull-flip rebuild', async () => {
    const db = await open();
    const live = table('T', { columns: [UUID, { name: 'name', type: 'text', notNull: false }] });
    await apply(db, [], [live]);
    await db.run('INSERT INTO "T" ("UUID", "name") VALUES (?, ?)', ['a', 'kept']);
    const desired = table('T', { columns: [UUID, { name: 'name', type: 'text', notNull: true }] });
    await apply(db, [live], [desired]);
    deepStrictEqual(await db.query('SELECT * FROM "T"'), [
      Object.assign(Object.create(null), { UUID: 'a', name: 'kept' }),
    ]);
    strictEqual((await dialect.describeTable(db, 'T')).columns[1]?.notNull, true);
    await noAsideRemains(db);
    await db.close();
  });

  it('rebuilds a primary-key change, rows intact', async () => {
    const db = await open();
    const live = table('T', { columns: [UUID, { name: 'locale', type: 'text', notNull: true }] });
    await apply(db, [], [live]);
    await db.run('INSERT INTO "T" ("UUID", "locale") VALUES (?, ?)', ['a', 'en']);
    const desired = { ...live, primaryKey: ['UUID', 'locale'] };
    await apply(db, [live], [desired]);
    deepStrictEqual((await dialect.describeTable(db, 'T')).primaryKey, ['UUID', 'locale']);
    strictEqual((await db.query('SELECT * FROM "T"')).length, 1);
    await db.close();
  });

  it('rebuilds a notNull column add on an empty table', async () => {
    const db = await open();
    const live = table('T');
    await apply(db, [], [live]);
    const desired = table('T', { columns: [UUID, { name: 'role', type: 'text', notNull: true }] });
    await apply(db, [live], [desired]);
    strictEqual((await dialect.describeTable(db, 'T')).columns[1]?.notNull, true);
    await db.close();
  });

  it('rebuilds away an inline unique constraint', async () => {
    const db = await open();
    await db.exec(
      'CREATE TABLE "T" ("UUID" TEXT NOT NULL, "email" TEXT UNIQUE, PRIMARY KEY ("UUID"))',
    );
    const live = await dialect.describeTable(db, 'T');
    strictEqual(live.uniques.length, 1);
    const desired = table('T', {
      columns: [UUID, { name: 'email', type: 'text', notNull: false }],
    });
    await apply(db, [live], [desired]);
    deepStrictEqual((await dialect.describeTable(db, 'T')).uniques, []);
    await db.close();
  });

  it('keeps a referencing table pointing at the rebuilt table, not the aside', async () => {
    const db = await open();
    const users = table('Users', {
      columns: [UUID, { name: 'name', type: 'text', notNull: false }],
    });
    const posts = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
      foreignKeys: [
        { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
    });
    await apply(db, [], [users, posts]);
    await db.run('INSERT INTO "Users" ("UUID", "name") VALUES (?, ?)', ['u1', 'ada']);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'u1']);
    const rebuilt = table('Users', {
      columns: [UUID, { name: 'name', type: 'text', notNull: true }],
    });
    await apply(db, [users, posts], [rebuilt, posts]);
    strictEqual((await dialect.describeTable(db, 'Posts')).foreignKeys[0]?.targetTable, 'Users');
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    await rejects(db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p2', 'ghost']));
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p3', 'u1']);
    await noAsideRemains(db);
    await db.close();
  });

  it('rebuilds a table whose name exceeds the aside cap', async () => {
    const db = await open();
    const live = table('A'.repeat(60), {
      columns: [UUID, { name: 'n', type: 'text', notNull: false }],
    });
    await apply(db, [], [live]);
    const desired = table('A'.repeat(60), {
      columns: [UUID, { name: 'n', type: 'integer', notNull: false }],
    });
    await apply(db, [live], [desired]);
    strictEqual((await dialect.describeTable(db, 'A'.repeat(60))).columns[1]?.type, 'integer');
    await noAsideRemains(db);
    await db.close();
  });
});

describe('sweepRebuilds', () => {
  it('drops leftover aside tables and nothing else', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "ohne_rebuild_Posts" ("a" TEXT)');
    await db.exec('CREATE TABLE "Posts" ("a" TEXT)');
    await sweepRebuilds(db, dialect);
    deepStrictEqual(await dialect.listTables(db), ['Posts']);
    await db.close();
  });

  it('spares foreign tables that only a LIKE wildcard would match', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "ohneXrebuildYdata" ("a" TEXT)');
    await db.exec('CREATE TABLE "OhneURebuildVLog" ("a" TEXT)');
    await sweepRebuilds(db, dialect);
    deepStrictEqual(await dialect.listTables(db), ['OhneURebuildVLog', 'ohneXrebuildYdata']);
    await db.close();
  });
});
