import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';
import type { OhneError } from '../../../../src/ohne/error/ohne-error.ts';

import { diffSchemas } from '../../../../src/ohne/database/schema/diff.ts';
import { guardDiffs } from '../../../../src/ohne/database/schema/guard.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

const UUID = { name: 'UUID', type: 'text', notNull: true } as const;

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
    await dialect.applyTableDiff(db, { kind: 'create', table: schema });
  }
}

async function guard(
  db: DatabaseAdapter,
  live: TableSchema[],
  desired: TableSchema[],
  force = false,
): Promise<ReturnType<typeof guardDiffs>> {
  return guardDiffs(db, dialect, diffSchemas(live, desired, dialect), live, desired, { force });
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
  it('refuses a required one-child table over parent rows that hold no child row', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const child = (required: boolean): TableSchema =>
      table('Posts_meta', {
        columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
        foreignKeys: [
          {
            column: '_parentUUID',
            targetTable: 'Posts',
            targetColumn: 'UUID',
            onDelete: 'cascade',
          },
        ],
        derived: {
          collection: 'Posts',
          path: ['meta'],
          kind: 'childOne',
          ...(required ? { required: true as const } : {}),
        },
      });
    await materialize(db, [posts, child(false)]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['a', 'b']);
    await db.run('INSERT INTO "Posts_meta" ("UUID", "_parentUUID") VALUES (?, ?)', ['m', 'a']);
    deepStrictEqual(await guard(db, [posts, child(false)], [posts, child(false)]), {
      deletions: [],
      warnings: [],
    });
    const error = await refusalOf(guard(db, [posts, child(false)], [posts, child(true)]));
    match(
      bodyOf(error),
      /field `Posts.meta` is required, but `Posts` holds `1` row without a `Posts_meta` row/,
    );
    await db.run('INSERT INTO "Posts_meta" ("UUID", "_parentUUID") VALUES (?, ?)', ['n', 'b']);
    deepStrictEqual(await guard(db, [posts, child(false)], [posts, child(true)]), {
      deletions: [],
      warnings: [],
    });
    await db.close();
  });

  it('counts a one-child table the sync recreates as holding no rows', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const parentKey = {
      column: '_parentUUID',
      targetTable: 'Posts',
      targetColumn: 'UUID',
      onDelete: 'cascade',
    } as const;
    const junction = table('Posts_meta', {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_targetUUID', type: 'text', notNull: true },
      ],
      primaryKey: ['_parentUUID', '_targetUUID'],
      derived: { collection: 'Posts', path: ['meta'], kind: 'junction' },
    });
    const one = table('Posts_meta', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      foreignKeys: [parentKey],
      derived: { collection: 'Posts', path: ['meta'], kind: 'childOne', required: true },
    });
    await materialize(db, [posts, junction]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    await db.run('INSERT INTO "Posts_meta" ("_parentUUID", "_targetUUID") VALUES (?, ?)', [
      'a',
      't',
    ]);
    const error = await refusalOf(guard(db, [posts, junction], [posts, one], true));
    match(
      bodyOf(error),
      /field `Posts.meta` is required, but `Posts` holds `1` row without a `Posts_meta` row/,
    );
    await db.close();
  });

  it('refuses a new required one-child table over a populated parent', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const child = table('Posts_meta', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      foreignKeys: [
        { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
      derived: { collection: 'Posts', path: ['meta'], kind: 'childOne', required: true },
    });
    await materialize(db, [posts]);
    deepStrictEqual(await guard(db, [posts], [posts, child]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const error = await refusalOf(guard(db, [posts], [posts, child]));
    match(
      bodyOf(error),
      /field `Posts.meta` is required, but `Posts` holds `1` row without a `Posts_meta` row/,
    );
    await db.close();
  });

  it('lets an empty diff through untouched', async () => {
    const db = await connectTest();
    deepStrictEqual(await guard(db, [], []), { deletions: [], warnings: [] });
    await db.close();
  });

  it('refuses a populated table drop and frees an empty one', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const empty = table('Drafts');
    await materialize(db, [posts, empty]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const error = await refusalOf(guard(db, [posts, empty], [empty]));
    match(bodyOf(error), /table `Posts` \(`1` row\)/);
    deepStrictEqual(await guard(db, [posts, empty], [posts]), { deletions: [], warnings: [] });
    await db.close();
  });

  it('refuses a populated column drop and frees an all-NULL one', async () => {
    const db = await connectTest();
    const live = table('Posts', {
      columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
    });
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['a', null]);
    deepStrictEqual(await guard(db, [live], [table('Posts')]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['b', 'kept']);
    const error = await refusalOf(guard(db, [live], [table('Posts')]));
    match(bodyOf(error), /column `Posts.legacy` \(`1` value\)/);
    await db.close();
  });

  it('refuses a retype only while the column holds values', async () => {
    const db = await connectTest();
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
    match(bodyOf(error), /column `Posts.count` \(`1` value, `text` -> `integer`\)/);
    await db.close();
  });

  it('blocks a retype under NOT NULL on a populated table even under force', async () => {
    const db = await connectTest();
    const live = table('Posts', {
      columns: [UUID, { name: 'views', type: 'text', notNull: true }],
    });
    const desired = table('Posts', {
      columns: [UUID, { name: 'views', type: 'integer', notNull: true }],
    });
    await materialize(db, [live]);
    deepStrictEqual(await guard(db, [live], [desired], true), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID", "views") VALUES (?, ?)', ['a', '9']);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /`Posts.views` retypes under NOT NULL, leaving `1` row/);
    match(bodyOf(error), /cannot resolve them/);
    await db.close();
  });

  it('blocks NOT NULL over NULL rows even under force', async () => {
    const db = await connectTest();
    const live = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    const desired = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: true }],
    });
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?)', ['a', null]);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /`Posts.title` becomes NOT NULL over `1` NULL row/);
    match(bodyOf(error), /cannot resolve them/);
    await db.close();
  });

  it('blocks a NOT NULL column add on a populated table, frees it on an empty one', async () => {
    const db = await connectTest();
    const live = table('Posts');
    const desired = table('Posts', {
      columns: [UUID, { name: 'role', type: 'text', notNull: true }],
    });
    await materialize(db, [live]);
    deepStrictEqual(await guard(db, [live], [desired]), { deletions: [], warnings: [] });
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const error = await refusalOf(guard(db, [live], [desired], true));
    match(bodyOf(error), /new column `Posts.role` is NOT NULL but `Posts` holds `1` row/);
    await db.close();
  });

  it('blocks a unique over duplicates even under force, NULLs never counting', async () => {
    const db = await connectTest();
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
    match(bodyOf(error), /unique `UX__Posts__slug` covers `1` duplicate group/);
    await db.close();
  });

  it('blocks a primary-key change over duplicate values', async () => {
    const db = await connectTest();
    const live = table('Posts', {
      columns: [UUID, { name: 'locale', type: 'text', notNull: true }],
    });
    const desired = { ...live, primaryKey: ['locale'] };
    await materialize(db, [live]);
    await db.run('INSERT INTO "Posts" ("UUID", "locale") VALUES (?, ?)', ['a', 'en']);
    await db.run('INSERT INTO "Posts" ("UUID", "locale") VALUES (?, ?)', ['b', 'en']);
    const error = await refusalOf(guard(db, [live], [desired]));
    match(bodyOf(error), /primary key over `locale` covers `1` duplicate group/);
    await db.close();
  });

  it('authorizes drops under force and reports every deletion', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const report = await guard(db, [posts], [], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /table `Posts`/);
    deepStrictEqual(report.warnings, []);
    await db.close();
  });

  it('refuses dangling rows under a foreign key being added, clears them under force', async () => {
    const db = await connectTest();
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
    match(bodyOf(error), /`1` row of `Posts` dangles from `Posts.author` to missing `Users` rows/);
    const report = await guard(db, [users, live], [users, desired], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /`1` value of `Posts.author` cleared/);
    deepStrictEqual(await db.query('SELECT "UUID", "author" FROM "Posts" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { UUID: 'p1', author: 'u1' }),
      Object.assign(Object.create(null), { UUID: 'p2', author: null }),
    ]);
    await db.close();
  });

  it('deletes dangling rows when the column is NOT NULL on either side', async () => {
    const db = await connectTest();
    const users = table('Users');
    const tightened = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
    });
    const tightenedDesired = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: true }],
      foreignKeys: [
        {
          column: 'author',
          targetTable: 'Users',
          targetColumn: 'UUID',
          onDelete: 'cascade' as const,
        },
      ],
    });
    await materialize(db, [users, tightened]);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'ghost']);
    const report = await guard(db, [users, tightened], [users, tightenedDesired], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /`1` row of `Posts` deleted/);
    deepStrictEqual(await db.query('SELECT * FROM "Posts"'), []);
    await db.close();
  });

  it('deletes dangling rows when the column relaxes to nullable this sync', async () => {
    const db = await connectTest();
    const users = table('Users');
    const live = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: true }],
    });
    const desired = table('Posts', {
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
    await materialize(db, [users, live]);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'ghost']);
    const report = await guard(db, [users, live], [users, desired], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /`1` row of `Posts` deleted/);
    deepStrictEqual(await db.query('SELECT * FROM "Posts"'), []);
    await db.close();
  });

  it('purges orphans under force on a table no diff touches, as the warning advises', async () => {
    const db = await connectTest();
    const users = table('Users');
    const posts = table('Posts', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
      foreignKeys: [
        { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
      ],
    });
    const reviewers = table('Posts_reviewers', {
      columns: [UUID, { name: 'reviewer', type: 'text', notNull: true }],
      foreignKeys: [
        { column: 'reviewer', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
    });
    await materialize(db, [users, posts, reviewers]);
    await dialect.schemaTransaction(db, async (tx) => {
      await tx.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'ghost']);
      await tx.run('INSERT INTO "Posts_reviewers" ("UUID", "reviewer") VALUES (?, ?)', [
        'r1',
        'ghost',
      ]);
    });
    const schemas = [users, posts, reviewers];
    deepStrictEqual(await guard(db, schemas, schemas), { deletions: [], warnings: [] });
    const forced = await guard(db, schemas, schemas, true);
    deepStrictEqual(forced.warnings, []);
    strictEqual(forced.deletions.length, 2);
    deepStrictEqual(await db.query('SELECT "UUID", "author" FROM "Posts"'), [
      Object.assign(Object.create(null), { UUID: 'p1', author: null }),
    ]);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Posts_reviewers"'), []);
    await db.close();
  });

  it('warns about orphans under a surviving foreign key without wedging the boot', async () => {
    const db = await connectTest();
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
    match(report.warnings[0] ?? '', /`1` row of `Posts` dangles/);
    deepStrictEqual(report.deletions, []);
    const forced = await guard(db, [users, posts], [users, touched], true);
    strictEqual(forced.deletions.length, 1);
    match(forced.deletions[0] ?? '', /`1` value of `Posts.author` cleared/);
    deepStrictEqual(await db.query('SELECT "UUID", "author" FROM "Posts"'), [
      Object.assign(Object.create(null), { UUID: 'p1', author: null }),
    ]);
    await db.close();
  });

  it('skips probes over columns arriving in the same sync', async () => {
    const db = await connectTest();
    const live = table('Users');
    await materialize(db, [live]);
    await db.run('INSERT INTO "Users" ("UUID") VALUES (?)', ['u1']);
    const desired = table('Users', {
      columns: [UUID, { name: 'email', type: 'text', notNull: false }],
      primaryKey: ['UUID', 'email'],
      uniques: [{ name: 'UX__Users__email', columns: ['email'] }],
      foreignKeys: [
        {
          column: 'email',
          targetTable: 'Users',
          targetColumn: 'UUID',
          onDelete: 'setNull' as const,
        },
      ],
    });
    deepStrictEqual(await guard(db, [live], [desired]), { deletions: [], warnings: [] });
    await db.close();
  });

  it('counts every value as dangling when the target arrives in the same sync', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'category', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "category") VALUES (?, ?)', ['p1', 'news']);
    await db.run('INSERT INTO "Posts" ("UUID", "category") VALUES (?, ?)', ['p2', 'tech']);
    await db.run('INSERT INTO "Posts" ("UUID", "category") VALUES (?, ?)', ['p3', null]);
    const categories = table('Categories');
    const desired = {
      ...posts,
      foreignKeys: [
        {
          column: 'category',
          targetTable: 'Categories',
          targetColumn: 'UUID',
          onDelete: 'setNull' as const,
        },
      ],
    };
    const error = await refusalOf(guard(db, [posts], [categories, desired]));
    match(bodyOf(error), /`2` rows of `Posts` dangle/);
    const report = await guard(db, [posts], [categories, desired], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /`2` values of `Posts.category` cleared/);
    deepStrictEqual(
      await db.query('SELECT "UUID" FROM "Posts" WHERE "category" IS NULL ORDER BY "UUID"'),
      [
        Object.assign(Object.create(null), { UUID: 'p1' }),
        Object.assign(Object.create(null), { UUID: 'p2' }),
        Object.assign(Object.create(null), { UUID: 'p3' }),
      ],
    );
    await db.close();
  });

  it('cascades a force purge through a self-referencing chain', async () => {
    const db = await connectTest();
    const nodes = table('Nodes', {
      columns: [UUID, { name: 'parent', type: 'text', notNull: true }],
    });
    await materialize(db, [nodes]);
    await db.run('INSERT INTO "Nodes" ("UUID", "parent") VALUES (?, ?)', ['A', 'missing']);
    await db.run('INSERT INTO "Nodes" ("UUID", "parent") VALUES (?, ?)', ['B', 'A']);
    await db.run('INSERT INTO "Nodes" ("UUID", "parent") VALUES (?, ?)', ['C', 'B']);
    const desired = {
      ...nodes,
      foreignKeys: [
        {
          column: 'parent',
          targetTable: 'Nodes',
          targetColumn: 'UUID',
          onDelete: 'cascade' as const,
        },
      ],
    };
    const report = await guard(db, [nodes], [desired], true);
    strictEqual(report.deletions.length, 3);
    deepStrictEqual(await db.query('SELECT * FROM "Nodes"'), []);
    await db.close();
  });

  it('purges rows of an untouched table orphaned by the purge itself', async () => {
    const db = await connectTest();
    const bosses = table('Bosses');
    const parents = table('Parents', {
      columns: [UUID, { name: 'boss', type: 'text', notNull: true }],
    });
    const children = table('Children', {
      columns: [UUID, { name: 'parent', type: 'text', notNull: true }],
      foreignKeys: [
        {
          column: 'parent',
          targetTable: 'Parents',
          targetColumn: 'UUID',
          onDelete: 'cascade' as const,
        },
      ],
    });
    await materialize(db, [bosses, parents, children]);
    await db.run('INSERT INTO "Parents" ("UUID", "boss") VALUES (?, ?)', ['P1', 'ghost']);
    await db.run('INSERT INTO "Parents" ("UUID", "boss") VALUES (?, ?)', ['P2', 'ghost2']);
    await db.run('INSERT INTO "Children" ("UUID", "parent") VALUES (?, ?)', ['C1', 'P1']);
    await db.run('INSERT INTO "Children" ("UUID", "parent") VALUES (?, ?)', ['C2', 'P2']);
    await db.run('INSERT INTO "Bosses" ("UUID") VALUES (?)', ['B1']);
    await db.run('UPDATE "Parents" SET "boss" = ? WHERE "UUID" = ?', ['B1', 'P2']);
    const desiredParents = {
      ...parents,
      foreignKeys: [
        {
          column: 'boss',
          targetTable: 'Bosses',
          targetColumn: 'UUID',
          onDelete: 'cascade' as const,
        },
      ],
    };
    const live = [bosses, parents, children];
    const desired = [bosses, desiredParents, children];
    const report = await dialect.schemaTransaction(db, (tx) =>
      guardDiffs(tx, dialect, diffSchemas(live, desired, dialect), live, desired, { force: true }),
    );
    strictEqual(report.deletions.length, 2);
    match(report.deletions.join('\n'), /row of `Parents` deleted/);
    match(report.deletions.join('\n'), /row of `Children` deleted/);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Parents"'), [
      Object.assign(Object.create(null), { UUID: 'P2' }),
    ]);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Children"'), [
      Object.assign(Object.create(null), { UUID: 'C2' }),
    ]);
    await db.close();
  });

  it('purges precisely on a table whose name matches the subquery alias', async () => {
    const db = await connectTest();
    const users = table('Users', {
      columns: [UUID, { name: 'author', type: 'text', notNull: false }],
    });
    const live = table('Target', {
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
    await db.run('INSERT INTO "Users" ("UUID", "author") VALUES (?, ?)', ['u1', null]);
    await db.run('INSERT INTO "Target" ("UUID", "author") VALUES (?, ?)', ['t1', 'u1']);
    await db.run('INSERT INTO "Target" ("UUID", "author") VALUES (?, ?)', ['t2', 'ghost']);
    const report = await guard(db, [users, live], [users, desired], true);
    strictEqual(report.deletions.length, 1);
    match(report.deletions[0] ?? '', /`1` value of `Target.author` cleared/);
    deepStrictEqual(await db.query('SELECT "UUID", "author" FROM "Target" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { UUID: 't1', author: 'u1' }),
      Object.assign(Object.create(null), { UUID: 't2', author: null }),
    ]);
    await db.close();
  });

  it('collects every finding into one refusal', async () => {
    const db = await connectTest();
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
