import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { FieldTypeMeta } from '../../../../src/ohne/fields/use-fields.ts';
import type { Registry } from '../../../../src/utils/index.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { diffSchemas } from '../../../../src/ohne/database/schema/diff.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { createRegistry } from '../../../../src/utils/index.ts';

const dialect = new SQLiteDialect();

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

function refusalMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    ok(isOhneError(error));
    strictEqual(error.title, 'Destructive sync refused');
    match(Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? ''), pattern);
    return true;
  };
}

function collections(...metas: CollectionMeta[]): Registry<CollectionMeta> {
  const registry = createRegistry<CollectionMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return registry;
}

function desiredOf(...metas: CollectionMeta[]): ReturnType<typeof buildDesiredSchema> {
  return buildDesiredSchema(collections(...metas), useFields() as Registry<FieldTypeMeta>);
}

function users(): CollectionMeta {
  return { name: 'Users', collection: { fields: {} } };
}

async function insertRow(db: DatabaseAdapter, table: string, uuid: string): Promise<void> {
  await db.run(`INSERT INTO "${table}" ("UUID", "_updatedAt") VALUES (?, ?)`, [uuid, 0]);
}

async function insertLink(
  db: DatabaseAdapter,
  table: string,
  parent: string,
  target: string,
  position = 0,
): Promise<void> {
  await db.run(
    `INSERT INTO "${table}" ("_parentUUID", "_targetUUID", "_parentPosition", "_targetPosition") ` +
      'VALUES (?, ?, ?, ?)',
    [parent, target, position, position],
  );
}

describe('syncDatabase with relations', () => {
  it('creates endpoints and a junction in one sync, introspection re-diffing to zero', async () => {
    const db = await open();
    const desired = desiredOf(users(), {
      name: 'Posts',
      collection: {
        fields: {
          author: field('record', { collection: 'Users' }),
          reviewers: field('records', { collection: 'Users' }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired });
    const live = await Promise.all(
      ['Users', 'Posts', 'Posts_reviewers'].map((name) => dialect.describeTable(db, name)),
    );
    deepStrictEqual(diffSchemas(live, desired, dialect), []);
    await syncDatabase(db, dialect, { desired });
    strictEqual((await dialect.listTables(db)).includes('Posts_reviewers'), true);
    await db.close();
  });

  it('enforces the junction constraints live: cascade, unique pair, parent cascade', async () => {
    const db = await open();
    const desired = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { reviewers: field('records', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Users', 'u2');
    await insertRow(db, 'Posts', 'p1');
    await insertLink(db, 'Posts_reviewers', 'p1', 'u1');
    await insertLink(db, 'Posts_reviewers', 'p1', 'u2', 1);

    await rejects(insertLink(db, 'Posts_reviewers', 'p1', 'u1', 2), (error: unknown) => {
      ok(dialect.isUniqueViolation(error));
      return true;
    });
    await rejects(insertLink(db, 'Posts_reviewers', 'p1', 'ghost', 3), (error: unknown) => {
      ok(dialect.isForeignKeyViolation(error));
      return true;
    });

    await db.run('DELETE FROM "Users" WHERE "UUID" = ?', ['u1']);
    deepStrictEqual(await db.query('SELECT "_targetUUID" FROM "Posts_reviewers"'), [
      Object.assign(Object.create(null), { _targetUUID: 'u2' }),
    ]);
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p1']);
    deepStrictEqual(await db.query('SELECT * FROM "Posts_reviewers"'), []);
    await db.close();
  });

  it('blocks a target delete under a restrict records field', async () => {
    const db = await open();
    const desired = desiredOf(users(), {
      name: 'Posts',
      collection: {
        fields: { reviewers: field('records', { collection: 'Users', onDelete: 'restrict' }) },
      },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await insertLink(db, 'Posts_reviewers', 'p1', 'u1');
    await rejects(db.run('DELETE FROM "Users" WHERE "UUID" = ?', ['u1']), (error: unknown) => {
      ok(dialect.isForeignKeyViolation(error));
      return true;
    });
    await db.close();
  });

  it('lands a foreign key on an existing populated table through a rebuild', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { author: field('text', { nullable: true, index: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');

    const after = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { author: field('record', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired: after });
    const posts = await dialect.describeTable(db, 'Posts');
    deepStrictEqual(posts.foreignKeys, [
      { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
    ]);
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    await db.close();
  });

  it('refuses a record retarget over live references, clears them under force', async () => {
    const db = await open();
    const before = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { author: field('record', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await db.run('UPDATE "Posts" SET "author" = ?', ['u1']);

    const after = desiredOf(
      users(),
      { name: 'Editors', collection: { fields: {} } },
      {
        name: 'Posts',
        collection: { fields: { author: field('record', { collection: 'Editors' }) } },
      },
    );
    await rejects(syncDatabase(db, dialect, { desired: after }), refusalMatching(/dangle/));

    const report = await syncDatabase(db, dialect, { desired: after, force: true });
    match(report.deletions.join('\n'), /`1` value of `Posts.author` cleared/);
    deepStrictEqual(await db.query('SELECT "UUID", "author" FROM "Posts"'), [
      Object.assign(Object.create(null), { UUID: 'p1', author: null }),
    ]);
    deepStrictEqual((await dialect.describeTable(db, 'Posts')).foreignKeys, [
      { column: 'author', targetTable: 'Editors', targetColumn: 'UUID', onDelete: 'setNull' },
    ]);
    await db.close();
  });

  it('refuses a records retarget over live links, deletes them under force', async () => {
    const db = await open();
    const before = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { reviewers: field('records', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await insertLink(db, 'Posts_reviewers', 'p1', 'u1');

    const after = desiredOf(
      users(),
      { name: 'Editors', collection: { fields: {} } },
      {
        name: 'Posts',
        collection: { fields: { reviewers: field('records', { collection: 'Editors' }) } },
      },
    );
    await rejects(syncDatabase(db, dialect, { desired: after }), refusalMatching(/dangle/));

    const report = await syncDatabase(db, dialect, { desired: after, force: true });
    match(report.deletions.join('\n'), /`1` row of `Posts_reviewers` deleted/);
    deepStrictEqual(await db.query('SELECT * FROM "Posts_reviewers"'), []);
    deepStrictEqual(
      (await dialect.describeTable(db, 'Posts_reviewers')).foreignKeys
        .map((foreignKey) => foreignKey.targetTable)
        .sort(),
      ['Editors', 'Posts'],
    );
    await db.close();
  });

  it('drops a populated junction only under force when its field is removed', async () => {
    const db = await open();
    const before = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { reviewers: field('records', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await insertLink(db, 'Posts_reviewers', 'p1', 'u1');

    const after = desiredOf(users(), { name: 'Posts', collection: { fields: {} } });
    await rejects(
      syncDatabase(db, dialect, { desired: after }),
      refusalMatching(/table `Posts_reviewers` \(`1` row\)/),
    );
    await syncDatabase(db, dialect, { desired: after, force: true });
    strictEqual((await dialect.listTables(db)).includes('Posts_reviewers'), false);
    await db.close();
  });

  it('syncs an inverse pair to one junction and replaces it destructively on a side flip', async () => {
    const db = await open();
    const before = desiredOf(
      {
        name: 'Users',
        collection: {
          fields: { posts: field('records', { collection: 'Posts', inverse: 'authors' }) },
        },
      },
      {
        name: 'Posts',
        collection: { fields: { authors: field('records', { collection: 'Users' }) } },
      },
    );
    await syncDatabase(db, dialect, { desired: before });
    const tables = await dialect.listTables(db);
    strictEqual(tables.includes('Posts_authors'), true);
    strictEqual(tables.includes('Users_posts'), false);

    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await insertLink(db, 'Posts_authors', 'p1', 'u1');

    const flipped = desiredOf(
      {
        name: 'Users',
        collection: { fields: { posts: field('records', { collection: 'Posts' }) } },
      },
      {
        name: 'Posts',
        collection: {
          fields: { authors: field('records', { collection: 'Users', inverse: 'posts' }) },
        },
      },
    );
    await rejects(
      syncDatabase(db, dialect, { desired: flipped }),
      refusalMatching(/table `Posts_authors` \(`1` row\)/),
    );
    await syncDatabase(db, dialect, { desired: flipped, force: true });
    const after = await dialect.listTables(db);
    strictEqual(after.includes('Users_posts'), true);
    strictEqual(after.includes('Posts_authors'), false);
    deepStrictEqual(await db.query('SELECT * FROM "Users_posts"'), []);
    await db.close();
  });

  it('syncs a self-referencing junction and links rows of one table', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { related: field('records', { collection: 'Posts' }) } },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Posts', 'p2');
    await insertLink(db, 'Posts_related', 'p1', 'p2');
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p2']);
    deepStrictEqual(await db.query('SELECT * FROM "Posts_related"'), []);
    strictEqual((await db.query('SELECT * FROM "Posts"')).length, 1);
    await db.close();
  });

  it('removes a referenced collection only alongside its referencing field', async () => {
    const db = await open();
    const before = desiredOf(users(), {
      name: 'Posts',
      collection: { fields: { author: field('record', { collection: 'Users' }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    const after = desiredOf({ name: 'Posts', collection: { fields: {} } });
    await syncDatabase(db, dialect, { desired: after });
    deepStrictEqual(await dialect.listTables(db), ['Posts', 'ohne_locks', 'ohne_schema']);
    await db.close();
  });
});
