import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
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

function meta(name: string, migration: Migration): MigrationMeta {
  return { name, migration, file: `/app/migrations/${name.split('/')[1]}.ts` };
}

async function insertRow(db: DatabaseAdapter, table: string, uuid: string): Promise<void> {
  await db.run(`INSERT INTO "${table}" ("UUID", "_updatedAt") VALUES (?, ?)`, [uuid, 0]);
}

async function countRows(db: DatabaseAdapter, table: string): Promise<number> {
  return (await db.query(`SELECT 1 FROM "${table}"`)).length;
}

describe('syncDatabase with composites', () => {
  it('creates object and repeater child tables in one sync, introspection re-diffing to zero', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { street: field('text') } }),
          sections: field('repeater', { fields: { title: field('text') } }),
        },
      },
    });
    const report = await syncDatabase(db, dialect, { desired });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    for (const table of desired) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await syncDatabase(db, dialect, { desired });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => name.startsWith('Posts')),
      ['Posts', 'Posts_address', 'Posts_sections'],
    );
    await db.close();
  });

  it('enforces one child row per parent on an object, the row following its parent', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: { address: field('object', { fields: { street: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID", "street") VALUES (?, ?, ?)', [
      'a1',
      'p1',
      'Main',
    ]);
    await rejects(
      db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID", "street") VALUES (?, ?, ?)', [
        'a2',
        'p1',
        'Side',
      ]),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p1']);
    strictEqual(await countRows(db, 'Posts_address'), 0);
    await db.close();
  });

  it('cascades deletes through nested repeaters', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          sections: field('repeater', {
            fields: {
              title: field('text'),
              items: field('repeater', { fields: { label: field('text') } }),
            },
          }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'intro'],
    );
    await db.run(
      'INSERT INTO "Posts_sections_items" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?)',
      ['i1', 's1', 0, 'first'],
    );
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p1']);
    strictEqual(await countRows(db, 'Posts_sections'), 0);
    strictEqual(await countRows(db, 'Posts_sections_items'), 0);
    await db.close();
  });

  it('refuses a repeater-to-object collapse over multi-row parents, force keeping the first row', async () => {
    const db = await open();
    const repeater = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('repeater', { fields: { title: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: repeater });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Posts', 'p2');
    for (const [uuid, parent, position, title] of [
      ['s1', 'p1', 2, 'late'],
      ['s2', 'p1', 0, 'first'],
      ['s3', 'p1', 1, 'middle'],
      ['s4', 'p2', 5, 'only'],
    ] as const) {
      await db.run(
        'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
        [uuid, parent, position, title],
      );
    }
    const object = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('object', { fields: { title: field('text') } }) },
      },
    });
    await rejects(
      syncDatabase(db, dialect, { desired: object }),
      refusalMatching(/`1` parents of `Posts_sections` hold multiple rows/),
    );
    const report = await syncDatabase(db, dialect, { desired: object, force: true });
    match(
      report.deletions.join('\n'),
      /`2` rows of `Posts_sections` deleted, keeping each parent's first row/,
    );
    const rows = await db.query<{ UUID: string; title: string }>(
      'SELECT "UUID", "title" FROM "Posts_sections" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.title]),
      [
        ['s2', 'first'],
        ['s4', 'only'],
      ],
    );
    const live = await dialect.describeTable(db, 'Posts_sections');
    deepStrictEqual(live.uniques, [
      { name: 'UX__Posts_sections___parentUUID', columns: ['_parentUUID'] },
    ]);
    strictEqual(
      live.columns.some((column) => column.name === '_parentPosition'),
      false,
    );
    await db.close();
  });

  it('collapses freely when every parent holds at most one row', async () => {
    const db = await open();
    const repeater = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('repeater', { fields: { title: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: repeater });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 3, 'kept'],
    );
    const object = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('object', { fields: { title: field('text') } }) },
      },
    });
    const report = await syncDatabase(db, dialect, { desired: object });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    const rows = await db.query<{ title: string }>('SELECT "title" FROM "Posts_sections"');
    deepStrictEqual(
      rows.map((row) => row.title),
      ['kept'],
    );
    await db.close();
  });

  it('breaks collapse ties by UUID when positions collide', async () => {
    const db = await open();
    const repeater = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('repeater', { fields: { title: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: repeater });
    await insertRow(db, 'Posts', 'p1');
    for (const [uuid, title] of [
      ['sb', 'second'],
      ['sa', 'first'],
    ] as const) {
      await db.run(
        'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
        [uuid, 'p1', 0, title],
      );
    }
    const object = desiredOf({
      name: 'Posts',
      collection: {
        fields: { sections: field('object', { fields: { title: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: object, force: true });
    const rows = await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts_sections"');
    deepStrictEqual(
      rows.map((row) => row.UUID),
      ['sa'],
    );
    await db.close();
  });

  it('sweeps nested rows orphaned by a collapse to a fixed point', async () => {
    const db = await open();
    const fields = (cardinality: 'object' | 'repeater'): CollectionMeta => ({
      name: 'Posts',
      collection: {
        fields: {
          sections: field(cardinality, {
            fields: {
              title: field('text'),
              items: field('repeater', { fields: { label: field('text') } }),
            },
          }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: desiredOf(fields('repeater')) });
    await insertRow(db, 'Posts', 'p1');
    for (const [uuid, position, title] of [
      ['s1', 0, 'kept'],
      ['s2', 1, 'dropped'],
    ] as const) {
      await db.run(
        'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
        [uuid, 'p1', position, title],
      );
    }
    for (const [uuid, parent, label] of [
      ['i1', 's1', 'survives'],
      ['i2', 's2', 'orphaned'],
    ] as const) {
      await db.run(
        'INSERT INTO "Posts_sections_items" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?)',
        [uuid, parent, 0, label],
      );
    }
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf(fields('object')),
      force: true,
    });
    match(report.deletions.join('\n'), /`1` rows of `Posts_sections` deleted/);
    match(report.deletions.join('\n'), /`1` rows of `Posts_sections_items` deleted, dangling/);
    const items = await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts_sections_items"');
    deepStrictEqual(
      items.map((row) => row.UUID),
      ['i1'],
    );
    await db.close();
  });

  it('refuses dropping a populated composite, deleting its tree under force', async () => {
    const db = await open();
    const withSections = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          sections: field('repeater', {
            fields: {
              title: field('text'),
              items: field('repeater', { fields: { label: field('text') } }),
            },
          }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: withSections });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'intro'],
    );
    await db.run(
      'INSERT INTO "Posts_sections_items" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?)',
      ['i1', 's1', 0, 'first'],
    );
    const without = desiredOf({ name: 'Posts', collection: { fields: {} } });
    await rejects(
      syncDatabase(db, dialect, { desired: without }),
      refusalMatching(
        /table `Posts_sections` \(`1` rows\)[\s\S]*table `Posts_sections_items` \(`1` rows\)/,
      ),
    );
    await syncDatabase(db, dialect, { desired: without, force: true });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => name.startsWith('Posts')),
      ['Posts'],
    );
    await db.close();
  });

  it('renames a collection through a migration, derived tables cascading', async () => {
    const db = await open();
    const shape = (name: string): CollectionMeta => ({
      name,
      collection: {
        fields: {
          authors: field('records', { collection: 'Users' }),
          sections: field('repeater', {
            fields: {
              title: field('text'),
              items: field('repeater', { fields: { label: field('text') } }),
            },
          }),
        },
      },
    });
    const users: CollectionMeta = { name: 'Users', collection: { fields: {} } };
    await syncDatabase(db, dialect, { desired: desiredOf(users, shape('Posts')) });
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_authors" ("_parentUUID", "_targetUUID", "_parentPosition", "_targetPosition") VALUES (?, ?, ?, ?)',
      ['p1', 'u1', 0, 0],
    );
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'intro'],
    );
    await db.run(
      'INSERT INTO "Posts_sections_items" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?)',
      ['i1', 's1', 0, 'first'],
    );
    const desired = desiredOf(users, shape('Articles'));
    const migrations = [
      meta('app/001-articles', { from: { table: 'Posts' }, to: { table: 'Articles' } }),
    ];
    const report = await syncDatabase(db, dialect, { desired, migrations });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Articles', 'Articles_authors', 'Articles_sections', 'Articles_sections_items', 'Users'],
    );
    for (const table of [
      'Articles',
      'Articles_authors',
      'Articles_sections',
      'Articles_sections_items',
    ]) {
      strictEqual(await countRows(db, table), 1);
    }
    const junction = await dialect.describeTable(db, 'Articles_authors');
    deepStrictEqual(junction.uniques, [
      {
        name: 'UX__Articles_authors___parentUUID__targetUUID',
        columns: ['_parentUUID', '_targetUUID'],
      },
    ]);
    const items = await dialect.describeTable(db, 'Articles_sections_items');
    deepStrictEqual(items.indexes, [
      { name: 'IX__Articles_sections_items___parentUUID', columns: ['_parentUUID'] },
    ]);
    deepStrictEqual(items.foreignKeys, [
      {
        column: '_parentUUID',
        targetTable: 'Articles_sections',
        targetColumn: 'UUID',
        onDelete: 'cascade',
      },
    ]);
    deepStrictEqual(await db.query('SELECT "name", "status" FROM "ohne_migrations"'), [
      Object.assign(Object.create(null), { name: 'app/001-articles', status: 'applied' }),
    ]);
    const again = await syncDatabase(db, dialect, { desired, migrations });
    deepStrictEqual(again, { deletions: [], warnings: [] });
    await db.close();
  });

  it('flattens an object subfield onto the parent through a move migration', async () => {
    const db = await open();
    const nested = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { city: field('text', { nullable: true }) } }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: nested });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Posts', 'p2');
    await db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID", "city") VALUES (?, ?, ?)', [
      'a1',
      'p1',
      'Berlin',
    ]);
    await db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID", "city") VALUES (?, ?, ?)', [
      'a2',
      'p2',
      'Wien',
    ]);
    const flat = desiredOf({
      name: 'Posts',
      collection: { fields: { city: field('text', { nullable: true }) } },
    });
    const migrations = [
      meta('app/001-flatten', {
        from: { table: 'Posts_address', column: 'city', type: 'text' },
        to: { table: 'Posts', column: 'city', type: 'text' },
      }),
      meta('app/002-drop-address', { from: { table: 'Posts_address' }, to: null }),
    ];
    await syncDatabase(db, dialect, { desired: flat, migrations });
    const rows = await db.query<{ UUID: string; city: string }>(
      'SELECT "UUID", "city" FROM "Posts" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.city]),
      [
        ['p1', 'Berlin'],
        ['p2', 'Wien'],
      ],
    );
    strictEqual((await dialect.listTables(db)).includes('Posts_address'), false);
    await db.close();
  });

  it('nests a parent column into its object child through a move migration', async () => {
    const db = await open();
    const flat = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          city: field('text', { nullable: true }),
          address: field('object', { fields: { city: field('text', { nullable: true }) } }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: flat });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "city") VALUES (?, ?, ?)', [
      'p1',
      0,
      'Berlin',
    ]);
    await db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID") VALUES (?, ?)', ['a1', 'p1']);
    const nested = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { city: field('text', { nullable: true }) } }),
        },
      },
    });
    const migrations = [
      meta('app/001-nest', {
        from: { table: 'Posts', column: 'city', type: 'text' },
        to: { table: 'Posts_address', column: 'city', type: 'text' },
      }),
    ];
    await syncDatabase(db, dialect, { desired: nested, migrations });
    const rows = await db.query<{ city: string }>('SELECT "city" FROM "Posts_address"');
    deepStrictEqual(
      rows.map((row) => row.city),
      ['Berlin'],
    );
    const live = await dialect.describeTable(db, 'Posts');
    strictEqual(
      live.columns.some((column) => column.name === 'city'),
      false,
    );
    await db.close();
  });

  it('refuses a cross-table move out of a repeater child', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { nullable: true }),
          sections: field('repeater', { fields: { title: field('text') } }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "title") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'intro'],
    );
    const migrations = [
      meta('app/001-hoist', {
        from: { table: 'Posts_sections', column: 'title', type: 'text' },
        to: { table: 'Posts', column: 'title', type: 'text' },
      }),
    ];
    await rejects(syncDatabase(db, dialect, { desired, migrations }), (error: unknown) => {
      ok(isOhneError(error));
      match(error.message, /cannot correlate rows/);
      match(
        Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? ''),
        /holds many rows per `Posts` row/,
      );
      return true;
    });
    await db.close();
  });
});
