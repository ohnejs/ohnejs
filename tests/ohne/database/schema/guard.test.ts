import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';
import type { OhneError } from '../../../../src/ohne/error/ohne-error.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import {
  createIndexes,
  createTable,
} from '../../../../src/ohne/database/dialects/sqlite/rebuild.ts';
import { diffSchemas } from '../../../../src/ohne/database/schema/diff.ts';
import { guardDiffs } from '../../../../src/ohne/database/schema/guard.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';

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

async function materialize(db: DatabaseAdapter, schemas: TableSchema[]): Promise<void> {
  for (const schema of schemas) {
    await createTable(db, dialect, schema);
    await createIndexes(db, dialect, schema);
  }
}

async function guard(
  db: DatabaseAdapter,
  live: TableSchema[],
  desired: TableSchema[],
  force = false,
): Promise<ReturnType<typeof guardDiffs>> {
  return guardDiffs(db, dialect, diffSchemas(live, desired, dialect), { force });
}

async function refusalOf(promise: Promise<unknown>): Promise<OhneError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  ok(isOhneError(error));
  strictEqual(error.title, 'Destructive sync refused');
  return error;
}

function bodyOf(error: OhneError): string {
  return Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
}

describe('guardDiffs', () => {
  it('lets an empty diff through untouched', async () => {
    const db = await open();
    deepStrictEqual(await guard(db, [], []), { deletions: [], warnings: [] });
    await db.close();
  });

  it('refuses a populated table drop and frees an empty one', async () => {
    const db = await open();
    const posts = table('Posts');
    const empty = table('Drafts');
    await materialize(db, [posts, empty]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const error = await refusalOf(guard(db, [posts, empty], [empty]));
    match(bodyOf(error), /table `Posts` \(`1` rows\)/);
    deepStrictEqual(await guard(db, [posts, empty], [posts]), { deletions: [], warnings: [] });
    await db.close();
  });

  it('refuses a populated column drop and frees an all-NULL one', async () => {
    const db = await open();
    const live = table('Posts', {
      columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
    });
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['a', null]);
    deepStrictEqual(await guard(db, [live], [table('Posts')]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['b', 'kept']);
    const error = await refusalOf(guard(db, [live], [table('Posts')]));
    match(bodyOf(error), /column `Posts.legacy` \(`1` values\)/);
    await db.close();
  });

  it('refuses a retype only while the column holds values', async () => {
    const db = await open();
    const live = table('Posts', {
      columns: [UUID, { name: 'count', type: 'text', notNull: false }],
    });
    const desired = table('Posts', {
      columns: [UUID, { name: 'count', type: 'integer', notNull: false }],
    });
    await materialize(db, [live]);
    deepStrictEqual(await guard(db, [live], [desired]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID", "count") VALUES (?, ?)', ['a', '42']);
    const error = await refusalOf(guard(db, [live], [desired]));
    match(bodyOf(error), /column `Posts.count` \(`1` values, `text` -> `integer`\)/);
    await db.close();
  });

  it('blocks NOT NULL over NULL rows even under force', async () => {
    const db = await open();
    const live = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    const desired = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: true }],
    });
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?)', ['a', null]);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /`Posts.title` becomes NOT NULL over `1` NULL rows/);
    match(bodyOf(error), /cannot resolve them/);
    await db.close();
  });

  it('blocks a NOT NULL column add on a populated table, frees it on an empty one', async () => {
    const db = await open();
    const live = table('Posts');
    const desired = table('Posts', {
      columns: [UUID, { name: 'role', type: 'text', notNull: true }],
    });
    await materialize(db, [live]);
    deepStrictEqual(await guard(db, [live], [desired]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /new column `Posts.role` is NOT NULL but `Posts` holds `1` rows/);
    await db.close();
  });

  it('blocks a unique over duplicates even under force, NULLs never counting', async () => {
    const db = await open();
    const live = table('Posts', {
      columns: [UUID, { name: 'slug', type: 'text', notNull: false }],
    });
    const desired = { ...live, uniques: [{ name: 'UX__Posts__slug', columns: ['slug'] }] };
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "slug") VALUES (?, ?)', ['a', null]);
    await db.run('INSERT INTO "Posts" ("UUID", "slug") VALUES (?, ?)', ['b', null]);
    deepStrictEqual(await guard(db, [live], [desired]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID", "slug") VALUES (?, ?)', ['c', 'dupe']);
    await db.run('INSERT INTO "Posts" ("UUID", "slug") VALUES (?, ?)', ['d', 'dupe']);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /unique `UX__Posts__slug` covers `1` duplicate groups/);
    await db.close();
  });

  it('blocks a primary-key change over duplicate values', async () => {
    const db = await open();
    const live = table('Posts', {
      columns: [UUID, { name: 'locale', type: 'text', notNull: true }],
    });
    const desired = { ...live, primaryKey: ['locale'] };
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "locale") VALUES (?, ?)', ['a', 'en']);
    await db.run('INSERT INTO "Posts" ("UUID", "locale") VALUES (?, ?)', ['b', 'en']);
    const error = await refusalOf(guard(db, [live], [desired]));
    match(bodyOf(error), /primary key over `locale` covers `1` duplicate groups/);
    await db.close();
  });

  it('authorizes drops under force and reports every deletion', async () => {
    const db = await open();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const report = await guard(db, [posts], [], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /table `Posts`/);
    deepStrictEqual(report.warnings, []);
    await db.close();
  });

  it('refuses dangling rows under a foreign key being added, purges them under force', async () => {
    const db = await open();
    const users = table('Users');
    const live = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
    });
    const desired = {
      ...live,
      foreignKeys: [
        {
          column: 'author',
          targetTable: 'Users',
          targetColumn: 'UUID',
          onDelete: 'setNull' as const,
        },
      ],
    };
    await materialize(db, [users, live]);
    await db.run('INSERT INTO "Users" ("UUID") VALUES (?)', ['u1']);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'u1']);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p2', 'ghost']);
    const error = await refusalOf(guard(db, [users, live], [users, desired]));
    match(bodyOf(error), /`1` rows of `Posts` dangle from `Posts.author` to missing `Users` rows/);
    const report = await guard(db, [users, live], [users, desired], true);
    strictEqual(report.deletions.length, 1);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Posts" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { UUID: 'p1' }),
    ]);
    await db.close();
  });

  it('warns about orphans under a surviving foreign key without wedging the boot', async () => {
    const db = await open();
    const users = table('Users');
    const posts = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
      foreignKeys: [
        {
          column: 'author',
          targetTable: 'Users',
          targetColumn: 'UUID',
          onDelete: 'setNull' as const,
        },
      ],
    });
    await materialize(db, [users, posts]);
    await dialect.schemaTransaction(db, async (tx) => {
      await tx.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'ghost']);
    });
    const touched = {
      ...posts,
      indexes: [{ name: 'IX__Posts__author', columns: ['author'] }],
    };
    const report = await guard(db, [users, posts], [users, touched]);
    strictEqual(report.warnings.length, 1);
    match(report.warnings[0] ?? '', /`1` rows of `Posts` dangle/);
    deepStrictEqual(report.deletions, []);
    const forced = await guard(db, [users, posts], [users, touched], true);
    strictEqual(forced.deletions.length, 1);
    deepStrictEqual(await db.query('SELECT * FROM "Posts"'), []);
    await db.close();
  });

  it('collects every finding into one refusal', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
    });
    const drafts = table('Drafts');
    await materialize(db, [posts, drafts]);
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['a', 'x']);
    await db.run('INSERT INTO "Drafts" ("UUID") VALUES (?)', ['d']);
    const error = await refusalOf(guard(db, [posts, drafts], [table('Posts')]));
    const body = bodyOf(error);
    match(body, /table `Drafts`/);
    match(body, /column `Posts.legacy`/);
    match(body, /FORCE_SYNC/);
    await db.close();
  });
});
