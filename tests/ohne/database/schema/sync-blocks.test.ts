import { deepStrictEqual, doesNotMatch, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { BlockMeta } from '../../../../src/ohne/blocks/use-blocks.ts';
import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';
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

function blocks(...metas: BlockMeta[]): Registry<BlockMeta> {
  const registry = createRegistry<BlockMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return registry;
}

function desiredOf(blockMetas: readonly BlockMeta[], ...metas: CollectionMeta[]): TableSchema[] {
  return buildDesiredSchema(
    collections(...metas),
    useFields() as Registry<FieldTypeMeta>,
    blocks(...blockMetas),
  );
}

function meta(name: string, migration: Migration): MigrationMeta {
  return { name, migration, file: `/app/migrations/${name.split('/')[1]}.ts` };
}

function hero(): BlockMeta {
  return { name: 'Hero', block: { fields: { title: field('text') } } };
}

function cta(): BlockMeta {
  return { name: 'CTA', block: { fields: { label: field('text') } } };
}

function posts(allow?: string[]): CollectionMeta {
  return {
    name: 'Posts',
    collection: { fields: { content: field('blocks', allow ? { allow } : undefined) } },
  };
}

function pages(allow?: string[]): CollectionMeta {
  return {
    name: 'Pages',
    collection: { fields: { content: field('blocks', allow ? { allow } : undefined) } },
  };
}

function tags(): CollectionMeta {
  return { name: 'Tags', collection: { fields: {} } };
}

function towerHero(): BlockMeta {
  return {
    name: 'Hero',
    block: {
      fields: {
        title: field('text'),
        gallery: field('repeater', {
          fields: {
            caption: field('text', { nullable: true }),
            cta: field('blocks', { allow: ['CTA'] }),
          },
        }),
      },
    },
  };
}

function towerCTA(): BlockMeta {
  return {
    name: 'CTA',
    block: {
      fields: {
        label: field('text'),
        tags: field('records', { collection: 'Tags' }),
        meta: field('object', { fields: { note: field('text', { nullable: true }) } }),
      },
    },
  };
}

function towerPosts(allow: string[]): CollectionMeta {
  return {
    name: 'Posts',
    collection: {
      fields: {
        sections: field('repeater', {
          fields: {
            heading: field('text', { nullable: true }),
            content: field('blocks', { allow }),
          },
        }),
      },
    },
  };
}

async function seedTower(db: DatabaseAdapter): Promise<void> {
  await insertRow(db, 'Posts', 'p1');
  await insertRow(db, 'Tags', 't1');
  await db.run(
    'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "heading") VALUES (?, ?, ?, ?)',
    ['s1', 'p1', 0, 'Top'],
  );
  await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
  await insertReference(db, 'Posts_sections_content', 'w1', 's1', 'Hero', 'h1');
  await db.run(
    'INSERT INTO "block_Hero_gallery" ("UUID", "_parentUUID", "_parentPosition", "caption") VALUES (?, ?, ?, ?)',
    ['g1', 'h1', 0, null],
  );
  await db.run('INSERT INTO "block_CTA" ("UUID", "label") VALUES (?, ?)', ['c1', 'Go']);
  await insertReference(db, 'block_Hero_gallery_cta', 'n1', 'g1', 'CTA', 'c1');
  await db.run(
    'INSERT INTO "block_CTA_tags" ("_parentUUID", "_targetUUID", "_parentPosition", "_targetPosition") ' +
      'VALUES (?, ?, ?, ?)',
    ['c1', 't1', 0, 0],
  );
  await db.run('INSERT INTO "block_CTA_meta" ("UUID", "_parentUUID", "note") VALUES (?, ?, ?)', [
    'm1',
    'c1',
    null,
  ]);
}

async function insertRow(db: DatabaseAdapter, table: string, uuid: string): Promise<void> {
  await db.run(`INSERT INTO "${table}" ("UUID", "_updatedAt") VALUES (?, ?)`, [uuid, 0]);
}

async function insertReference(
  db: DatabaseAdapter,
  wrapper: string,
  uuid: string,
  parent: string,
  type: string,
  block: string,
  position = 0,
): Promise<void> {
  await db.run(
    `INSERT INTO "${wrapper}" ("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ` +
      'VALUES (?, ?, ?, ?, ?)',
    [uuid, parent, position, type, block],
  );
}

async function countRows(db: DatabaseAdapter, table: string): Promise<number> {
  return (await db.query(`SELECT 1 FROM "${table}"`)).length;
}

describe('syncDatabase with blocks', () => {
  it('creates wrapper and per-type tables in one sync, introspection re-diffing to zero', async () => {
    const db = await open();
    const desired = desiredOf([hero(), cta()], posts(['Hero', 'CTA']));
    const report = await syncDatabase(db, dialect, { desired });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    for (const table of desired) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await syncDatabase(db, dialect, { desired });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Posts', 'Posts_content', 'block_CTA', 'block_Hero'],
    );
    await db.close();
  });

  it('materializes only reachable blocks, dropping a table once nothing allows its type', async () => {
    const db = await open();
    const both = [hero(), cta()];
    await syncDatabase(db, dialect, { desired: desiredOf(both, posts()) });
    ok((await dialect.listTables(db)).includes('block_CTA'));
    await syncDatabase(db, dialect, { desired: desiredOf(both, posts(['Hero'])) });
    ok(!(await dialect.listTables(db)).includes('block_CTA'));
    ok((await dialect.listTables(db)).includes('block_Hero'));
    await db.close();
  });

  it('refuses an allow-list shrink over live references, naming the block and force alone', async () => {
    const db = await open();
    const both = [hero(), cta()];
    await syncDatabase(db, dialect, {
      desired: desiredOf(both, posts(['Hero', 'CTA']), pages(['Hero'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    const shrunk = desiredOf(both, posts(['CTA']), pages(['Hero']));
    await rejects(syncDatabase(db, dialect, { desired: shrunk }), (error: unknown) => {
      ok(isOhneError(error));
      const body = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
      match(body, /`1` rows of `Posts_content` hold block `Hero`, no longer allowed there/);
      match(body, /Set `FORCE_SYNC`/);
      doesNotMatch(body, /Cover these with a discard or move migration/);
      return true;
    });
    const report = await syncDatabase(db, dialect, { desired: shrunk, force: true });
    match(report.deletions.join('\n'), /`1` rows of `block_Hero` deleted, no longer referenced/);
    match(
      report.deletions.join('\n'),
      /`1` rows of `Posts_content` deleted, holding blocks no longer allowed/,
    );
    strictEqual(await countRows(db, 'Posts_content'), 0);
    strictEqual(await countRows(db, 'block_Hero'), 0);
    ok((await dialect.listTables(db)).includes('block_Hero'));
    await db.close();
  });

  it('keeps a block row another wrapper still references when a shrink purges one field', async () => {
    const db = await open();
    const both = [hero(), cta()];
    const wide = desiredOf(both, posts(['Hero', 'CTA']), pages(['Hero']));
    await syncDatabase(db, dialect, { desired: wide });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Pages', 'g1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'Pages_content', 'w2', 'g1', 'Hero', 'h1');
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf(both, posts(['CTA']), pages(['Hero'])),
      force: true,
    });
    doesNotMatch(report.deletions.join('\n'), /block_Hero/);
    strictEqual(await countRows(db, 'Posts_content'), 0);
    strictEqual(await countRows(db, 'Pages_content'), 1);
    strictEqual(await countRows(db, 'block_Hero'), 1);
    await db.close();
  });

  it('refuses a block type removal over live rows; force purges the type everywhere', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: desiredOf([hero(), cta()], posts()) });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await db.run('INSERT INTO "block_CTA" ("UUID", "label") VALUES (?, ?)', ['c1', 'Go']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'Posts_content', 'w2', 'p1', 'CTA', 'c1', 1);
    const withoutHero = desiredOf([cta()], posts());
    await rejects(
      syncDatabase(db, dialect, { desired: withoutHero }),
      refusalMatching(
        /table `block_Hero` \(`1` rows\)[\s\S]*`1` rows of `Posts_content` hold block `Hero`/,
      ),
    );
    const report = await syncDatabase(db, dialect, { desired: withoutHero, force: true });
    match(report.deletions.join('\n'), /table `block_Hero`/);
    match(
      report.deletions.join('\n'),
      /rows of `Posts_content` deleted, holding blocks no longer allowed/,
    );
    ok(!(await dialect.listTables(db)).includes('block_Hero'));
    strictEqual(await countRows(db, 'Posts_content'), 1);
    strictEqual(await countRows(db, 'block_CTA'), 1);
    await db.close();
  });

  it('sweeps nested block data to a fixed point when a shrink strands a whole subtree', async () => {
    const db = await open();
    const nestingHero: BlockMeta = {
      name: 'Hero',
      block: { fields: { title: field('text'), content: field('blocks', { allow: ['CTA'] }) } },
    };
    const wide = desiredOf([nestingHero, cta()], posts(['Hero', 'CTA']), pages(['Hero']));
    await syncDatabase(db, dialect, { desired: wide });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await db.run('INSERT INTO "block_CTA" ("UUID", "label") VALUES (?, ?)', ['c1', 'Go']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'block_Hero_content', 'n1', 'h1', 'CTA', 'c1');
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf([nestingHero, cta()], posts(['CTA']), pages(['Hero'])),
      force: true,
    });
    match(report.deletions.join('\n'), /`1` rows of `block_Hero` deleted/);
    match(report.deletions.join('\n'), /`1` rows of `block_Hero_content` deleted, dangling/);
    match(report.deletions.join('\n'), /`1` rows of `block_CTA` deleted/);
    strictEqual(await countRows(db, 'block_Hero'), 0);
    strictEqual(await countRows(db, 'block_Hero_content'), 0);
    strictEqual(await countRows(db, 'block_CTA'), 0);
    await db.close();
  });

  it('discards a blocks field through a migration, sweeping its data without force', async () => {
    const db = await open();
    const nestingHero: BlockMeta = {
      name: 'Hero',
      block: { fields: { title: field('text'), content: field('blocks', { allow: ['CTA'] }) } },
    };
    await syncDatabase(db, dialect, {
      desired: desiredOf([nestingHero, cta()], posts(['Hero', 'CTA'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await db.run('INSERT INTO "block_CTA" ("UUID", "label") VALUES (?, ?)', ['c1', 'Go']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'block_Hero_content', 'n1', 'h1', 'CTA', 'c1');
    const withoutField = desiredOf([], { name: 'Posts', collection: { fields: {} } });
    const report = await syncDatabase(db, dialect, {
      desired: withoutField,
      migrations: [
        meta('app/001-drop-content', { from: { collection: 'Posts', field: 'content' }, to: null }),
      ],
    });
    match(report.deletions.join('\n'), /`1` rows of `block_Hero` deleted, no longer referenced/);
    match(report.deletions.join('\n'), /`1` rows of `block_Hero_content` deleted, dangling/);
    match(report.deletions.join('\n'), /`1` rows of `block_CTA` deleted/);
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Posts'],
    );
    deepStrictEqual(await db.query('SELECT "name", "status" FROM "ohne_migrations"'), [
      Object.assign(Object.create(null), { name: 'app/001-drop-content', status: 'applied' }),
    ]);
    strictEqual(await countRows(db, 'Posts'), 1);
    await db.close();
  });

  it('refuses a blocks field removal without a migration, still offering the discard path', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: desiredOf([hero()], posts(['Hero'])) });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await rejects(
      syncDatabase(db, dialect, {
        desired: desiredOf([], { name: 'Posts', collection: { fields: {} } }),
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        const body = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
        match(body, /table `Posts_content` \(`1` rows\)/);
        match(body, /table `block_Hero` \(`1` rows\)/);
        match(body, /Cover these with a discard or move migration/);
        match(body, /Or set `FORCE_SYNC`/);
        return true;
      },
    );
    await db.close();
  });

  it('bars one wrapper from placing a block instance twice, other wrappers staying free', async () => {
    const db = await open();
    await syncDatabase(db, dialect, {
      desired: desiredOf([hero()], posts(['Hero']), pages(['Hero'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Posts', 'p2');
    await insertRow(db, 'Pages', 'g1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await rejects(
      insertReference(db, 'Posts_content', 'w2', 'p2', 'Hero', 'h1'),
      /UNIQUE constraint failed: Posts_content\._blockUUID/,
    );
    await insertReference(db, 'Pages_content', 'w3', 'g1', 'Hero', 'h1');
    strictEqual(await countRows(db, 'Posts_content'), 1);
    strictEqual(await countRows(db, 'Pages_content'), 1);
    await db.close();
  });

  it('leaves unreferenced block rows alone: cleanup is the write layer to own, never the sync', async () => {
    const db = await open();
    const desired = desiredOf([hero()], posts(['Hero']));
    await syncDatabase(db, dialect, { desired });
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Stray']);
    const report = await syncDatabase(db, dialect, { desired, force: true });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    strictEqual(await countRows(db, 'block_Hero'), 1);
    await db.close();
  });

  it('cascades a collection rename over its wrapper, the shared block tables staying put', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: desiredOf([hero()], posts(['Hero'])) });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    const renamed = desiredOf([hero()], {
      name: 'Articles',
      collection: { fields: { content: field('blocks', { allow: ['Hero'] }) } },
    });
    const report = await syncDatabase(db, dialect, {
      desired: renamed,
      migrations: [
        meta('app/001-articles', { from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
      ],
    });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Articles', 'Articles_content', 'block_Hero'],
    );
    strictEqual(await countRows(db, 'Articles_content'), 1);
    strictEqual(await countRows(db, 'block_Hero'), 1);
    for (const table of renamed) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('renames a blocks field through a migration, the wrapper following with its rows', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: desiredOf([hero()], posts(['Hero'])) });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    const renamed = desiredOf([hero()], {
      name: 'Posts',
      collection: { fields: { body: field('blocks', { allow: ['Hero'] }) } },
    });
    const report = await syncDatabase(db, dialect, {
      desired: renamed,
      migrations: [
        meta('app/001-body', {
          from: { collection: 'Posts', field: 'content' },
          to: { collection: 'Posts', field: 'body' },
        }),
      ],
    });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    strictEqual(await countRows(db, 'Posts_body'), 1);
    strictEqual(await countRows(db, 'block_Hero'), 1);
    for (const table of renamed) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('lets relations live inside a block, their foreign keys enforced at runtime', async () => {
    const db = await open();
    const teamHero: BlockMeta = {
      name: 'Hero',
      block: {
        fields: {
          author: field('record', { collection: 'Users' }),
          tags: field('records', { collection: 'Tags' }),
        },
      },
    };
    const users: CollectionMeta = { name: 'Users', collection: { fields: {} } };
    const tags: CollectionMeta = { name: 'Tags', collection: { fields: {} } };
    const desired = desiredOf([teamHero], posts(['Hero']), users, tags);
    await syncDatabase(db, dialect, { desired });
    for (const table of desired) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await insertRow(db, 'Users', 'u1');
    await insertRow(db, 'Tags', 't1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "author") VALUES (?, ?)', ['h1', 'u1']);
    await db.run(
      'INSERT INTO "block_Hero_tags" ("_parentUUID", "_targetUUID", "_parentPosition", "_targetPosition") ' +
        'VALUES (?, ?, ?, ?)',
      ['h1', 't1', 0, 0],
    );
    await db.run('DELETE FROM "Users" WHERE "UUID" = ?', ['u1']);
    deepStrictEqual(await db.query('SELECT "author" FROM "block_Hero"'), [
      Object.assign(Object.create(null), { author: null }),
    ]);
    await db.run('DELETE FROM "block_Hero" WHERE "UUID" = ?', ['h1']);
    strictEqual(await countRows(db, 'block_Hero_tags'), 0);
    await db.close();
  });

  it('sweeps a self-referencing block chain, the fixed point re-entering the same table', async () => {
    const db = await open();
    const selfHero: BlockMeta = {
      name: 'Hero',
      block: { fields: { title: field('text'), content: field('blocks', { allow: ['Hero'] }) } },
    };
    await syncDatabase(db, dialect, {
      desired: desiredOf([selfHero], posts(['Hero']), pages(['Hero'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'h1',
      'Outer',
      'h2',
      'Inner',
    ]);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'block_Hero_content', 'n1', 'h1', 'Hero', 'h2');
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf(
        [selfHero],
        { name: 'Posts', collection: { fields: {} } },
        pages(['Hero']),
      ),
      force: true,
    });
    match(report.deletions.join('\n'), /table `Posts_content` \(`1` rows\)/);
    match(report.deletions.join('\n'), /rows of `block_Hero` deleted/);
    match(report.deletions.join('\n'), /rows of `block_Hero_content` deleted, dangling/);
    strictEqual(await countRows(db, 'block_Hero'), 0);
    strictEqual(await countRows(db, 'block_Hero_content'), 0);
    await db.close();
  });

  it('reshapes a blocks field into an object under force, sweeping what the wrapper held', async () => {
    const db = await open();
    await syncDatabase(db, dialect, { desired: desiredOf([hero()], posts(['Hero'])) });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    const reshaped = desiredOf([], {
      name: 'Posts',
      collection: {
        fields: {
          content: field('object', { fields: { street: field('text', { nullable: true }) } }),
        },
      },
    });
    await rejects(syncDatabase(db, dialect, { desired: reshaped }), refusalMatching(/block_Hero/));
    const report = await syncDatabase(db, dialect, { desired: reshaped, force: true });
    match(report.deletions.join('\n'), /table `block_Hero` \(`1` rows\)/);
    ok(!(await dialect.listTables(db)).includes('block_Hero'));
    strictEqual(await countRows(db, 'Posts_content'), 1);
    const live = await dialect.describeTable(db, 'Posts_content');
    ok(!live.columns.some((column) => column.name === '_blockType'));
    await db.close();
  });

  it('nests blocks under a repeater and a repeater under a block, the tower re-diffing to zero', async () => {
    const db = await open();
    const desired = desiredOf([towerHero(), towerCTA()], towerPosts(['Hero']), tags());
    const report = await syncDatabase(db, dialect, { desired });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    for (const table of desired) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      [
        'Posts',
        'Posts_sections',
        'Posts_sections_content',
        'Tags',
        'block_CTA',
        'block_CTA_meta',
        'block_CTA_tags',
        'block_Hero',
        'block_Hero_gallery',
        'block_Hero_gallery_cta',
      ],
    );
    await seedTower(db);
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p1']);
    strictEqual(await countRows(db, 'Posts_sections'), 0);
    strictEqual(await countRows(db, 'Posts_sections_content'), 0);
    strictEqual(await countRows(db, 'block_Hero'), 1);
    await db.close();
  });

  it('discards a repeater holding blocks, the sweep clearing the whole subtree without force', async () => {
    const db = await open();
    await syncDatabase(db, dialect, {
      desired: desiredOf([towerHero(), towerCTA()], towerPosts(['Hero']), tags()),
    });
    await seedTower(db);
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf([], { name: 'Posts', collection: { fields: {} } }, tags()),
      migrations: [
        meta('app/001-drop-sections', {
          from: { collection: 'Posts', field: 'sections' },
          to: null,
        }),
      ],
    });
    const lines = report.deletions.join('\n');
    match(lines, /`1` rows of `block_Hero` deleted, no longer referenced/);
    match(lines, /`1` rows of `block_Hero_gallery` deleted, dangling/);
    match(lines, /`1` rows of `block_Hero_gallery_cta` deleted, dangling/);
    match(lines, /`1` rows of `block_CTA` deleted, no longer referenced/);
    match(lines, /`1` rows of `block_CTA_tags` deleted, dangling/);
    match(lines, /`1` rows of `block_CTA_meta` deleted, dangling/);
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Posts', 'Tags'],
    );
    strictEqual(await countRows(db, 'Posts'), 1);
    strictEqual(await countRows(db, 'Tags'), 1);
    await db.close();
  });

  it('probes an allow shrink on a wrapper nested under a repeater, force sweeping through it', async () => {
    const db = await open();
    const wide = desiredOf(
      [towerHero(), towerCTA()],
      towerPosts(['Hero', 'CTA']),
      tags(),
      pages(['Hero']),
    );
    await syncDatabase(db, dialect, { desired: wide });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "heading") VALUES (?, ?, ?, ?)',
      ['s1', 'p1', 0, null],
    );
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_sections_content', 'w1', 's1', 'Hero', 'h1');
    const shrunk = desiredOf(
      [towerHero(), towerCTA()],
      towerPosts(['CTA']),
      tags(),
      pages(['Hero']),
    );
    await rejects(
      syncDatabase(db, dialect, { desired: shrunk }),
      refusalMatching(
        /`1` rows of `Posts_sections_content` hold block `Hero`, no longer allowed there/,
      ),
    );
    const report = await syncDatabase(db, dialect, { desired: shrunk, force: true });
    match(report.deletions.join('\n'), /`1` rows of `block_Hero` deleted, no longer referenced/);
    strictEqual(await countRows(db, 'Posts_sections_content'), 0);
    strictEqual(await countRows(db, 'block_Hero'), 0);
    ok((await dialect.listTables(db)).includes('block_Hero'));
    await db.close();
  });

  it('renames a repeater holding blocks, the nested wrapper following with its rows', async () => {
    const db = await open();
    await syncDatabase(db, dialect, {
      desired: desiredOf([towerHero(), towerCTA()], towerPosts(['Hero']), tags()),
    });
    await seedTower(db);
    const renamed = desiredOf(
      [towerHero(), towerCTA()],
      {
        name: 'Posts',
        collection: {
          fields: {
            parts: field('repeater', {
              fields: {
                heading: field('text', { nullable: true }),
                content: field('blocks', { allow: ['Hero'] }),
              },
            }),
          },
        },
      },
      tags(),
    );
    const report = await syncDatabase(db, dialect, {
      desired: renamed,
      migrations: [
        meta('app/001-parts', {
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'parts' },
        }),
      ],
    });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    strictEqual(await countRows(db, 'Posts_parts_content'), 1);
    strictEqual(await countRows(db, 'block_Hero'), 1);
    strictEqual(await countRows(db, 'block_Hero_gallery_cta'), 1);
    for (const table of renamed) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('collapses a repeater whose blocks ride into an object, sweeping only the stranded instances', async () => {
    const db = await open();
    const sections = (kind: 'repeater' | 'object'): CollectionMeta => ({
      name: 'Posts',
      collection: {
        fields: {
          sections: field(kind, {
            fields: {
              label: field('text', { nullable: true }),
              content: field('blocks', { allow: ['Hero'] }),
            },
          }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: desiredOf([hero()], sections('repeater')) });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "label") ' +
        'VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'kept', 's2', 'p1', 1, 'dropped'],
    );
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'h1',
      'First',
      'h2',
      'Second',
    ]);
    await insertReference(db, 'Posts_sections_content', 'w1', 's1', 'Hero', 'h1');
    await insertReference(db, 'Posts_sections_content', 'w2', 's2', 'Hero', 'h2');
    const reshaped = desiredOf([hero()], sections('object'));
    await rejects(
      syncDatabase(db, dialect, { desired: reshaped }),
      refusalMatching(/`1` parents of `Posts_sections` hold multiple rows/),
    );
    const report = await syncDatabase(db, dialect, { desired: reshaped, force: true });
    const lines = report.deletions.join('\n');
    match(lines, /`1` rows of `Posts_sections` deleted, keeping each parent's first row/);
    match(lines, /`1` rows of `block_Hero` deleted, no longer referenced/);
    match(lines, /`1` rows of `Posts_sections_content` deleted, dangling/);
    deepStrictEqual(await db.query('SELECT "label" FROM "Posts_sections"'), [
      Object.assign(Object.create(null), { label: 'kept' }),
    ]);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "block_Hero"'), [
      Object.assign(Object.create(null), { UUID: 'h1' }),
    ]);
    strictEqual(await countRows(db, 'Posts_sections_content'), 1);
    for (const table of reshaped) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('keeps a shared block instance when a discard migration drops one of two wrappers', async () => {
    const db = await open();
    await syncDatabase(db, dialect, {
      desired: desiredOf([hero()], posts(['Hero']), pages(['Hero'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Pages', 'g1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    await insertReference(db, 'Pages_content', 'w2', 'g1', 'Hero', 'h1');
    const report = await syncDatabase(db, dialect, {
      desired: desiredOf([hero()], { name: 'Posts', collection: { fields: {} } }, pages(['Hero'])),
      migrations: [
        meta('app/001-drop-content', { from: { collection: 'Posts', field: 'content' }, to: null }),
      ],
    });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    ok(!(await dialect.listTables(db)).includes('Posts_content'));
    strictEqual(await countRows(db, 'block_Hero'), 1);
    strictEqual(await countRows(db, 'Pages_content'), 1);
    await db.close();
  });

  it('probes the allow set of a wrapper a same-sync migration renamed, refusal rolling stamps back', async () => {
    const db = await open();
    await syncDatabase(db, dialect, {
      desired: desiredOf([hero(), cta()], posts(['Hero', 'CTA']), pages(['Hero'])),
    });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    await insertReference(db, 'Posts_content', 'w1', 'p1', 'Hero', 'h1');
    const renamed = desiredOf(
      [hero(), cta()],
      {
        name: 'Articles',
        collection: { fields: { content: field('blocks', { allow: ['CTA'] }) } },
      },
      pages(['Hero']),
    );
    const migrations = [
      meta('app/001-articles', { from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
    ];
    await rejects(
      syncDatabase(db, dialect, { desired: renamed, migrations }),
      refusalMatching(/`1` rows of `Articles_content` hold block `Hero`, no longer allowed there/),
    );
    strictEqual(await countRows(db, 'ohne_migrations'), 0);
    ok((await dialect.listTables(db)).includes('Posts_content'));
    const report = await syncDatabase(db, dialect, { desired: renamed, migrations, force: true });
    match(report.deletions.join('\n'), /`1` rows of `block_Hero` deleted, no longer referenced/);
    match(report.deletions.join('\n'), /`1` rows of `Articles_content` deleted, holding blocks/);
    deepStrictEqual(await db.query('SELECT "name", "status" FROM "ohne_migrations"'), [
      Object.assign(Object.create(null), { name: 'app/001-articles', status: 'applied' }),
    ]);
    strictEqual(await countRows(db, 'Articles_content'), 0);
    ok((await dialect.listTables(db)).includes('block_Hero'));
    await db.close();
  });
});
