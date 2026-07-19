import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../../src/ohne/database/adapter.ts';

import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';

const dialect = new SQLiteDialect();

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

describe('listTables', () => {
  it('lists created tables sorted by name', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Posts" ("UUID" TEXT PRIMARY KEY)');
    await db.exec('CREATE TABLE "Authors" ("UUID" TEXT PRIMARY KEY)');
    deepStrictEqual(await dialect.listTables(db), ['Authors', 'Posts']);
  });

  it('excludes SQLite internals', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "counters" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
    await db.run('INSERT INTO "counters" DEFAULT VALUES');
    deepStrictEqual(await dialect.listTables(db), ['counters']);
  });
});

describe('describeTable', () => {
  it('normalizes columns, notNull, and the primary key', async () => {
    const db = await open();
    await db.exec(
      'CREATE TABLE "Posts" ("UUID" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "views" INTEGER)',
    );
    deepStrictEqual(await dialect.describeTable(db, 'Posts'), {
      name: 'Posts',
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'title', type: 'text', notNull: true },
        { name: 'views', type: 'integer', notNull: false },
      ],
      primaryKey: ['UUID'],
      uniques: [],
      indexes: [],
      foreignKeys: [],
    });
  });

  it('maps declared types by affinity, the INT test winning over the REAL one', async () => {
    const db = await open();
    await db.exec(
      'CREATE TABLE "T" ' +
        '("big" BIGINT, "label" VARCHAR(20), "ratio" REAL, "score" DOUBLE, "wave" FLOATING POINT)',
    );
    deepStrictEqual(
      (await dialect.describeTable(db, 'T')).columns.map((column) => column.type),
      ['integer', 'text', 'real', 'real', 'integer'],
    );
  });

  it('orders a composite primary key by key position, autoindex excluded', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "T" ("b" TEXT, "a" TEXT, PRIMARY KEY ("b", "a"))');
    const schema = await dialect.describeTable(db, 'T');
    deepStrictEqual(schema.primaryKey, ['b', 'a']);
    deepStrictEqual(schema.uniques, []);
  });

  it('separates unique indexes from plain indexes', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Posts" ("slug" TEXT, "author" TEXT)');
    await db.exec('CREATE UNIQUE INDEX "UX__Posts__slug" ON "Posts" ("slug")');
    await db.exec('CREATE INDEX "IX__Posts__author_slug" ON "Posts" ("author", "slug")');
    const schema = await dialect.describeTable(db, 'Posts');
    deepStrictEqual(schema.uniques, [{ name: 'UX__Posts__slug', columns: ['slug'] }]);
    deepStrictEqual(schema.indexes, [
      { name: 'IX__Posts__author_slug', columns: ['author', 'slug'] },
    ]);
  });

  it('reports an inline unique constraint as a unique', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "T" ("email" TEXT UNIQUE)');
    const { uniques } = await dialect.describeTable(db, 'T');
    strictEqual(uniques.length, 1);
    deepStrictEqual(uniques[0]?.columns, ['email']);
  });

  it('skips expression indexes', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "T" ("email" TEXT)');
    await db.exec('CREATE INDEX "expr" ON "T" (lower("email"))');
    deepStrictEqual((await dialect.describeTable(db, 'T')).indexes, []);
  });

  it('maps foreign keys structurally with their onDelete action', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Users" ("UUID" TEXT PRIMARY KEY)');
    await db.exec(
      'CREATE TABLE "Posts" ("UUID" TEXT PRIMARY KEY, "author" TEXT REFERENCES "Users" ("UUID") ON DELETE SET NULL)',
    );
    deepStrictEqual((await dialect.describeTable(db, 'Posts')).foreignKeys, [
      { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
    ]);
  });

  it('defaults a foreign key without an action to noAction', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Users" ("UUID" TEXT PRIMARY KEY)');
    await db.exec('CREATE TABLE "Posts" ("author" TEXT REFERENCES "Users" ("UUID"))');
    strictEqual((await dialect.describeTable(db, 'Posts')).foreignKeys[0]?.onDelete, 'noAction');
  });

  it('resolves a column-less references clause to UUID', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Users" ("UUID" TEXT PRIMARY KEY)');
    await db.exec('CREATE TABLE "Posts" ("author" TEXT REFERENCES "Users" ON DELETE CASCADE)');
    deepStrictEqual((await dialect.describeTable(db, 'Posts')).foreignKeys, [
      { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
    ]);
  });

  it('handles identifiers needing quoting', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "we""ird" ("a" TEXT)');
    const schema = await dialect.describeTable(db, 'we"ird');
    strictEqual(schema.name, 'we"ird');
    deepStrictEqual(schema.columns, [{ name: 'a', type: 'text', notNull: false }]);
  });
});
