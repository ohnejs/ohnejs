import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { BlockMeta } from '../../../../src/ohne/blocks/use-blocks.ts';
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

function blocks(...metas: BlockMeta[]): Registry<BlockMeta> {
  const registry = createRegistry<BlockMeta>();
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

async function insertTranslation(
  db: DatabaseAdapter,
  table: string,
  parent: string,
  locale: string,
  column: string,
  value: string,
): Promise<void> {
  await db.run(
    `INSERT INTO "${table}" ("_parentUUID", "_localeCode", "${column}") VALUES (?, ?, ?)`,
    [parent, locale, value],
  );
}

async function countRows(db: DatabaseAdapter, table: string): Promise<number> {
  return (await db.query(`SELECT 1 FROM "${table}"`)).length;
}

describe('syncDatabase with translatable scalars', () => {
  it('creates the companion in one sync, introspection re-diffing to zero', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          slug: field('text', {
            unique: true,
            translatable: true,
            uniquePerLocale: true,
          }),
          views: field('integer'),
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
      ['Posts', 'Posts__translations'],
    );
    await db.close();
  });

  it('keys one row per parent and locale, rows following their parent', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    await rejects(
      insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Again'),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    await db.run('DELETE FROM "Posts" WHERE "UUID" = ?', ['p1']);
    strictEqual(await countRows(db, 'Posts__translations'), 0);
    await db.close();
  });

  it('scopes `uniquePerLocale` to one locale, a global unique spanning all', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          slug: field('text', { unique: true, translatable: true, uniquePerLocale: true }),
          isbn: field('text', { unique: true, translatable: true, nullable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Posts', 'p2');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'slug', 'hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'slug', 'hello');
    await rejects(
      insertTranslation(db, 'Posts__translations', 'p2', 'en', 'slug', 'hello'),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    await db.run(
      'UPDATE "Posts__translations" SET "isbn" = ? WHERE "_parentUUID" = ? AND "_localeCode" = ?',
      ['x-1', 'p1', 'en'],
    );
    await rejects(
      db.run(
        'UPDATE "Posts__translations" SET "isbn" = ? WHERE "_parentUUID" = ? AND "_localeCode" = ?',
        ['x-1', 'p1', 'de'],
      ),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    await db.close();
  });

  it('adds a translatable field to a populated collection without a refusal', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { views: field('integer') } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "views") VALUES (?, ?, ?)', [
      'p1',
      0,
      7,
    ]);
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: { views: field('integer'), title: field('text', { translatable: true }) },
      },
    });
    const report = await syncDatabase(db, dialect, { desired: after });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    strictEqual(await countRows(db, 'Posts__translations'), 0);
    await db.close();
  });

  it('refuses to drop a populated companion, a logical discard escalating to the table', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          views: field('integer', { nullable: true }),
          title: field('text', { translatable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { views: field('integer', { nullable: true }) } },
    });
    await rejects(
      syncDatabase(db, dialect, { desired: after }),
      refusalMatching(/`Posts__translations`/),
    );
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-drop-title', { from: { collection: 'Posts', field: 'title' }, to: null }),
      ],
    });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => name.startsWith('Posts')),
      ['Posts'],
    );
    deepStrictEqual(await db.query('SELECT "name", "status" FROM "ohne_migrations"'), [
      Object.assign(Object.create(null), { name: 'app/001-drop-title', status: 'applied' }),
    ]);
    await db.close();
  });

  it('renames a translatable field on the companion, values surviving every locale', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { headline: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-headline', {
          from: { collection: 'Posts', field: 'title' },
          to: { collection: 'Posts', field: 'headline' },
        }),
      ],
    });
    deepStrictEqual(
      await db.query(
        'SELECT "_localeCode" AS "locale", "headline" FROM "Posts__translations" ORDER BY "_localeCode"',
      ),
      [
        Object.assign(Object.create(null), { locale: 'de', headline: 'Hallo' }),
        Object.assign(Object.create(null), { locale: 'en', headline: 'Hello' }),
      ],
    );
    await db.close();
  });

  it('carries a populated companion through a collection rename', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    const after = desiredOf({
      name: 'Articles',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-articles', { from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
      ],
    });
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => !name.startsWith('ohne_')),
      ['Articles', 'Articles__translations'],
    );
    strictEqual(await countRows(db, 'Articles__translations'), 1);
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });
});

describe('syncDatabase with a translatable record', () => {
  it('probes the companion foreign key on a retarget, force clearing the references', async () => {
    const db = await open();
    const users: CollectionMeta = { name: 'Users', collection: { fields: {} } };
    const teams: CollectionMeta = { name: 'Teams', collection: { fields: {} } };
    const before = desiredOf(
      {
        name: 'Posts',
        collection: {
          fields: { author: field('record', { collection: 'Users', translatable: true }) },
        },
      },
      users,
      teams,
    );
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Users', 'u1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'author', 'u1');
    const after = desiredOf(
      {
        name: 'Posts',
        collection: {
          fields: { author: field('record', { collection: 'Teams', translatable: true }) },
        },
      },
      users,
      teams,
    );
    await rejects(
      syncDatabase(db, dialect, { desired: after }),
      refusalMatching(/`Posts__translations`.*dangle|dangle.*`Posts__translations`/),
    );
    const report = await syncDatabase(db, dialect, { desired: after, force: true });
    match(report.deletions.join('\n'), /`Posts__translations\.author` cleared/);
    deepStrictEqual(await db.query('SELECT "author" FROM "Posts__translations"'), [
      Object.assign(Object.create(null), { author: null }),
    ]);
    await db.close();
  });
});

describe('syncDatabase fan-out, off -> on', () => {
  it('moves every main value into a default-locale companion row, losslessly', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text'), views: field('integer', { nullable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await db.run(
      'INSERT INTO "Posts" ("UUID", "_updatedAt", "title") VALUES (?, ?, ?), (?, ?, ?)',
      ['p1', 0, 'Hello', 'p2', 0, 'World'],
    );
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          views: field('integer', { nullable: true }),
        },
      },
    });
    const report = await syncDatabase(db, dialect, { desired: after, defaultLocale: 'de' });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(
      await db.query(
        'SELECT "_parentUUID" AS "parent", "_localeCode" AS "locale", "title" FROM "Posts__translations" ORDER BY "_parentUUID"',
      ),
      [
        Object.assign(Object.create(null), { parent: 'p1', locale: 'de', title: 'Hello' }),
        Object.assign(Object.create(null), { parent: 'p2', locale: 'de', title: 'World' }),
      ],
    );
    deepStrictEqual(
      (await dialect.describeTable(db, 'Posts')).columns.map((column) => column.name),
      ['UUID', '_updatedAt', 'views'],
    );
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('upserts into an existing companion: default-locale rows fill, other locales survive', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          subtitle: field('text', { nullable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await db.run('UPDATE "Posts" SET "subtitle" = ?', ['Sub']);
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          subtitle: field('text', { nullable: true, translatable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: after });
    deepStrictEqual(
      await db.query(
        'SELECT "_localeCode" AS "locale", "title", "subtitle" FROM "Posts__translations" ORDER BY "_localeCode"',
      ),
      [
        Object.assign(Object.create(null), { locale: 'de', title: 'Hallo', subtitle: null }),
        Object.assign(Object.create(null), { locale: 'en', title: 'Hello', subtitle: 'Sub' }),
      ],
    );
    await db.close();
  });

  it('creates no row for an entity whose flipped values are all NULL', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text', { nullable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text', { nullable: true, translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: after });
    strictEqual(await countRows(db, 'Posts__translations'), 0);
    await db.close();
  });

  it('stamps the default locale onto a populated object child, the unique widening', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: { address: field('object', { fields: { street: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await db.run('INSERT INTO "Posts_address" ("UUID", "_parentUUID", "street") VALUES (?, ?, ?)', [
      'a1',
      'p1',
      'Main',
    ]);
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { street: field('text') }, translatable: true }),
        },
      },
    });
    const report = await syncDatabase(db, dialect, { desired: after, defaultLocale: 'fr' });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(
      await db.query('SELECT "_localeCode" AS "locale", "street" FROM "Posts_address"'),
      [Object.assign(Object.create(null), { locale: 'fr', street: 'Main' })],
    );
    await db.run(
      'INSERT INTO "Posts_address" ("UUID", "_parentUUID", "_localeCode", "street") VALUES (?, ?, ?, ?)',
      ['a2', 'p1', 'de', 'Haupt'],
    );
    await rejects(
      db.run(
        'INSERT INTO "Posts_address" ("UUID", "_parentUUID", "_localeCode", "street") VALUES (?, ?, ?, ?)',
        ['a3', 'p1', 'fr', 'Rue'],
      ),
      (error: unknown) => dialect.isUniqueViolation(error),
    );
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('backfills a populated junction, the structural path alone staying blocked', async () => {
    const db = await open();
    const tags: CollectionMeta = { name: 'Tags', collection: { fields: {} } };
    const before = desiredOf(
      { name: 'Posts', collection: { fields: { tags: field('records', { collection: 'Tags' }) } } },
      tags,
    );
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertRow(db, 'Tags', 't1');
    await db.run(
      'INSERT INTO "Posts_tags" ("_parentUUID", "_targetUUID", "_parentPosition", "_targetPosition") VALUES (?, ?, ?, ?)',
      ['p1', 't1', 0, 0],
    );
    const after = desiredOf(
      {
        name: 'Posts',
        collection: {
          fields: { tags: field('records', { collection: 'Tags', translatable: true }) },
        },
      },
      tags,
    );
    await syncDatabase(db, dialect, { desired: after });
    deepStrictEqual(await db.query('SELECT "_localeCode" AS "locale" FROM "Posts_tags"'), [
      Object.assign(Object.create(null), { locale: 'en' }),
    ]);
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('refuses a flip that retypes at the same time, naming the two-deploy fix', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { count: field('integer') } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "count") VALUES (?, ?, ?)', [
      'p1',
      0,
      7,
    ]);
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { count: field('text', { translatable: true }) } },
    });
    await rejects(syncDatabase(db, dialect, { desired: after }), (error: unknown) => {
      ok(isOhneError(error));
      match(error.title ?? '', /retypes while turning translatable/);
      return true;
    });
    await db.close();
  });

  it('refuses the flip on -> off without a migration, force dropping the locale data', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { nullable: true, translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { nullable: true }) } },
    });
    await rejects(
      syncDatabase(db, dialect, { desired: after }),
      refusalMatching(/`Posts__translations`/),
    );
    const report = await syncDatabase(db, dialect, { desired: after, force: true });
    match(report.deletions.join('\n'), /`Posts__translations`/);
    deepStrictEqual(await db.query('SELECT "title" FROM "Posts"'), [
      Object.assign(Object.create(null), { title: null }),
    ]);
    await db.close();
  });
});

describe('syncDatabase switch migrations, fan-in', () => {
  it('promotes the default locale, deletes the rest, and satisfies a NOT NULL main', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text') } },
    });
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-title-single', {
          from: { collection: 'Posts', field: 'title', translatable: true },
          transform: (value, row, ctx) => (ctx.locale === 'en' ? value : ctx.deleteRecord()),
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "title" FROM "Posts"'), [
      Object.assign(Object.create(null), { title: 'Hello' }),
    ]);
    deepStrictEqual(
      (await dialect.listTables(db)).filter((name) => name.startsWith('Posts')),
      ['Posts'],
    );
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('keeps other locales and columns when one field of a multi-translatable collection flips', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          subtitle: field('text', { nullable: true, translatable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts__translations" ("_parentUUID", "_localeCode", "title", "subtitle") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['p1', 'en', 'Hello', 'Sub', 'p1', 'de', 'Hallo', null],
    );
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          subtitle: field('text', { nullable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-subtitle-single', {
          from: { collection: 'Posts', field: 'subtitle', translatable: true },
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "subtitle" FROM "Posts"'), [
      Object.assign(Object.create(null), { subtitle: 'Sub' }),
    ]);
    deepStrictEqual(
      await db.query(
        'SELECT "_localeCode" AS "locale", "title" FROM "Posts__translations" ORDER BY "_localeCode"',
      ),
      [
        Object.assign(Object.create(null), { locale: 'de', title: 'Hallo' }),
        Object.assign(Object.create(null), { locale: 'en', title: 'Hello' }),
      ],
    );
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });

  it('errors early when an entity promotes nothing into a NOT NULL main, rolling back whole', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text') } },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-title-single', {
            from: { collection: 'Posts', field: 'title', translatable: true },
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /leaves `1` entities without a value/);
        return true;
      },
    );
    strictEqual(await countRows(db, 'Posts__translations'), 1);
    strictEqual(await countRows(db, 'ohne_migrations'), 0);
    await db.close();
  });

  it('refuses two promoted values for one entity, naming it', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text') } },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-title-single', {
            from: { collection: 'Posts', field: 'title', translatable: true },
            transform: (value) => value,
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /promotes two values for one entity/);
        return true;
      },
    );
    await db.close();
  });

  it('collapses a translatable object: one survivor passes, two abort at the unique', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { street: field('text') }, translatable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_address" ("UUID", "_parentUUID", "_localeCode", "street") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['a1', 'p1', 'en', 'Main', 'a2', 'p1', 'de', 'Haupt'],
    );
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: { address: field('object', { fields: { street: field('text') } }) },
      },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-address-single', {
            from: { collection: 'Posts', field: 'address', translatable: true },
            transform: () => undefined,
          }),
        ],
      }),
      refusalMatching(/duplicate groups/),
    );
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/002-address-single', {
          from: { collection: 'Posts', field: 'address', translatable: true },
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "street" FROM "Posts_address"'), [
      Object.assign(Object.create(null), { street: 'Main' }),
    ]);
    for (const table of after) {
      const live = await dialect.describeTable(db, table.name);
      deepStrictEqual(diffSchemas([live], [table], dialect), []);
    }
    await db.close();
  });
});

describe('syncDatabase switch migrations, value passes', () => {
  it('backfills NULLs through a nullable switch, passing the guard', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text', { nullable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "note") VALUES (?, ?, ?), (?, ?, ?)', [
      'p1',
      0,
      null,
      'p2',
      0,
      'kept',
    ]);
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text') } },
    });
    await rejects(
      syncDatabase(db, dialect, { desired: after }),
      refusalMatching(/becomes NOT NULL over `1` NULL rows/),
    );
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-note-required', {
          from: { collection: 'Posts', field: 'note', nullable: true },
          transform: (value) => value ?? 'filled',
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "note" FROM "Posts" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { note: 'filled' }),
      Object.assign(Object.create(null), { note: 'kept' }),
    ]);
    await db.close();
  });

  it('massages duplicates through a unique switch; an unresolved one still refuses', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { slug: field('text') } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "slug") VALUES (?, ?, ?), (?, ?, ?)', [
      'p1',
      0,
      'a',
      'p2',
      0,
      'a',
    ]);
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { slug: field('text', { unique: true }) } },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-slug-unique', {
            from: { collection: 'Posts', field: 'slug', unique: false },
            transform: (value) => value,
          }),
        ],
      }),
      refusalMatching(/duplicate groups/),
    );
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/002-slug-unique', {
          from: { collection: 'Posts', field: 'slug', unique: false },
          transform: (value, row) => `${String(value)}-${String(row.UUID)}`,
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "slug" FROM "Posts" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { slug: 'a-p1' }),
      Object.assign(Object.create(null), { slug: 'a-p2' }),
    ]);
    await db.close();
  });

  it('skips a switch whose state already holds, naming the state', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text') } },
    });
    await syncDatabase(db, dialect, { desired });
    await syncDatabase(db, dialect, {
      desired,
      migrations: [
        meta('app/001-note-required', {
          from: { collection: 'Posts', field: 'note', nullable: true },
        }),
      ],
    });
    const stamps = await db.query<{ name: string; status: string; reason: string }>(
      'SELECT "name", "status", "reason" FROM "ohne_migrations" ORDER BY "name"',
    );
    strictEqual(stamps[0]?.status, 'skipped');
    match(stamps[0]?.reason ?? '', /already holds `nullable: false`/);
    await db.close();
  });

  it('skips a switch on a fresh database end to end', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text') } },
    });
    await syncDatabase(db, dialect, {
      desired,
      migrations: [
        meta('app/001-note-required', {
          from: { collection: 'Posts', field: 'note', nullable: true },
        }),
      ],
    });
    deepStrictEqual(
      await db.query('SELECT "name", "status" FROM "ohne_migrations" ORDER BY "name"'),
      [Object.assign(Object.create(null), { name: 'app/001-note-required', status: 'skipped' })],
    );
    await db.close();
  });

  it('refuses an explicit `to` disagreeing with the desired schema', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text', { nullable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await rejects(
      syncDatabase(db, dialect, {
        desired: before,
        migrations: [
          meta('app/001-note-required', {
            from: { collection: 'Posts', field: 'note', nullable: true },
            to: { nullable: false },
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /switches against the desired schema/);
        return true;
      },
    );
    await db.close();
  });
});

describe('syncDatabase switch migrations, audit regressions', () => {
  it('sweeps the block instances a fan-in dooms, still-referenced ones surviving', async () => {
    const db = await open();
    const hero: BlockMeta = { name: 'Hero', block: { fields: { heading: field('text') } } };
    const before = buildDesiredSchema(
      collections({
        name: 'Pages',
        collection: { fields: { content: field('blocks', { translatable: true }) } },
      }),
      useFields() as Registry<FieldTypeMeta>,
      blocks(hero),
    );
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Pages', 'p1');
    await db.run(
      'INSERT INTO "Pages_content" ("UUID", "_parentUUID", "_localeCode", "_parentPosition", "_blockType", "_blockUUID") VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
      ['w-en', 'p1', 'en', 0, 'Hero', 'b-en', 'w-de', 'p1', 'de', 0, 'Hero', 'b-de'],
    );
    await db.run('INSERT INTO "block_Hero" ("UUID", "heading") VALUES (?, ?), (?, ?)', [
      'b-en',
      'Hello',
      'b-de',
      'Hallo',
    ]);
    const after = buildDesiredSchema(
      collections({
        name: 'Pages',
        collection: { fields: { content: field('blocks') } },
      }),
      useFields() as Registry<FieldTypeMeta>,
      blocks(hero),
    );
    const report = await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-content-single', {
          from: { collection: 'Pages', field: 'content', translatable: true },
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Pages_content"'), [
      Object.assign(Object.create(null), { UUID: 'w-en' }),
    ]);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "block_Hero"'), [
      Object.assign(Object.create(null), { UUID: 'b-en' }),
    ]);
    match(report.deletions.join('\n'), /`block_Hero`/);
    await db.close();
  });

  it('cascades a fan-in over the nested children of its doomed rows', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          sections: field('repeater', {
            fields: {
              title: field('text'),
              items: field('repeater', { fields: { label: field('text') } }),
            },
            translatable: true,
          }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_localeCode", "_parentPosition", "title") VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      ['s-en', 'p1', 'en', 0, 'Intro', 's-de', 'p1', 'de', 0, 'Einleitung'],
    );
    await db.run(
      'INSERT INTO "Posts_sections_items" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['i-en', 's-en', 0, 'keep', 'i-de', 's-de', 0, 'drop'],
    );
    const after = desiredOf({
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
    const report = await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-sections-single', {
          from: { collection: 'Posts', field: 'sections', translatable: true },
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Posts_sections_items"'), [
      Object.assign(Object.create(null), { UUID: 'i-en' }),
    ]);
    match(report.deletions.join('\n'), /`Posts_sections_items`/);
    await db.close();
  });

  it('cascades a value-pass entity deletion over children and companion rows', async () => {
    const db = await open();
    const shape = (unique: boolean) =>
      desiredOf({
        name: 'Posts',
        collection: {
          fields: {
            slug: field('text', unique ? { unique: true } : {}),
            note: field('text', { nullable: true, translatable: true }),
            sections: field('repeater', { fields: { label: field('text') } }),
          },
        },
      });
    await syncDatabase(db, dialect, { desired: shape(false) });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt", "slug") VALUES (?, ?, ?), (?, ?, ?)', [
      'p1',
      0,
      'a',
      'p2',
      0,
      'a',
    ]);
    await db.run(
      'INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "_parentPosition", "label") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['s1', 'p1', 0, 'keep', 's2', 'p2', 0, 'drop'],
    );
    await insertTranslation(db, 'Posts__translations', 'p2', 'en', 'note', 'doomed');
    const report = await syncDatabase(db, dialect, {
      desired: shape(true),
      migrations: [
        meta('app/001-slug-unique', {
          from: { collection: 'Posts', field: 'slug', unique: false },
          transform: (value, row, ctx) => (String(row.UUID) === 'p2' ? ctx.deleteRecord() : value),
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Posts"'), [
      Object.assign(Object.create(null), { UUID: 'p1' }),
    ]);
    deepStrictEqual(await db.query('SELECT "UUID" FROM "Posts_sections"'), [
      Object.assign(Object.create(null), { UUID: 's1' }),
    ]);
    strictEqual(await countRows(db, 'Posts__translations'), 0);
    match(report.deletions.join('\n'), /`Posts_sections`.*deleted parents/);
    await db.close();
  });

  it('refuses a transform-less fan-in that retypes at the same time', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { count: field('text', { nullable: true, translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'count', 'needs review');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { count: field('integer', { nullable: true }) } },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-count-single', {
            from: { collection: 'Posts', field: 'count', translatable: true },
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /retypes `Posts.count` untransformed/);
        return true;
      },
    );
    await db.close();
  });

  it('refuses a switch whose desired schema never flips the state', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired });
    await rejects(
      syncDatabase(db, dialect, {
        desired,
        migrations: [
          meta('app/001-title-single', {
            from: { collection: 'Posts', field: 'title', translatable: true },
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /switches `translatable` onto its own state/);
        return true;
      },
    );
    await db.close();
  });

  it('refuses a transform on a composite fan-out: nothing reshapes', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: { address: field('object', { fields: { street: field('text') } }) },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    const after = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          address: field('object', { fields: { street: field('text') }, translatable: true }),
        },
      },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-address-locale', {
            from: { collection: 'Posts', field: 'address', translatable: false },
            transform: () => undefined,
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /reshapes a composite fan-out/);
        return true;
      },
    );
    await db.close();
  });

  it('refuses a stale fan-out switch naming the missing companion column', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: {
        fields: {
          title: field('text', { translatable: true }),
          note: field('text', { nullable: true }),
        },
      },
    });
    await syncDatabase(db, dialect, { desired: before });
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [
          meta('app/001-note-locale', {
            from: { collection: 'Posts', field: 'note', translatable: false },
            to: { translatable: true },
            transform: (value) => value,
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /cannot fan `Posts.note` out/);
        return true;
      },
    );
    await db.close();
  });

  it('refuses an absent field even under an explicit `to`', async () => {
    const db = await open();
    const desired = desiredOf({
      name: 'Posts',
      collection: { fields: { note: field('text', { nullable: true }) } },
    });
    await syncDatabase(db, dialect, { desired });
    await rejects(
      syncDatabase(db, dialect, {
        desired,
        migrations: [
          meta('app/001-titel-required', {
            from: { collection: 'Posts', field: 'titel', nullable: true },
            to: { nullable: false },
          }),
        ],
      }),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /cannot run/);
        return true;
      },
    );
    await db.close();
  });

  it('hands a move transform the locale of each companion row', async () => {
    const db = await open();
    const before = desiredOf({
      name: 'Posts',
      collection: { fields: { title: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, { desired: before });
    await insertRow(db, 'Posts', 'p1');
    await insertTranslation(db, 'Posts__translations', 'p1', 'en', 'title', 'Hello');
    await insertTranslation(db, 'Posts__translations', 'p1', 'de', 'title', 'Hallo');
    const after = desiredOf({
      name: 'Posts',
      collection: { fields: { headline: field('text', { translatable: true }) } },
    });
    await syncDatabase(db, dialect, {
      desired: after,
      migrations: [
        meta('app/001-headline', {
          from: { collection: 'Posts', field: 'title' },
          to: { collection: 'Posts', field: 'headline' },
          transform: (value, _row, ctx) => `${ctx.locale ?? 'none'}-${String(value)}`,
        }),
      ],
    });
    deepStrictEqual(
      await db.query(
        'SELECT "_localeCode" AS "locale", "headline" FROM "Posts__translations" ORDER BY "_localeCode"',
      ),
      [
        Object.assign(Object.create(null), { locale: 'de', headline: 'de-Hallo' }),
        Object.assign(Object.create(null), { locale: 'en', headline: 'en-Hello' }),
      ],
    );
    await db.close();
  });

  it('backfills a nested subfield through a nullable switch, the desired home resolving', async () => {
    const db = await open();
    const shape = (nullable: boolean) =>
      desiredOf({
        name: 'Posts',
        collection: {
          fields: {
            meta: field('object', {
              fields: { description: field('text', nullable ? { nullable: true } : {}) },
            }),
          },
        },
      });
    await syncDatabase(db, dialect, { desired: shape(true) });
    await insertRow(db, 'Posts', 'p1');
    await db.run(
      'INSERT INTO "Posts_meta" ("UUID", "_parentUUID", "description") VALUES (?, ?, ?)',
      ['m1', 'p1', null],
    );
    await syncDatabase(db, dialect, {
      desired: shape(false),
      migrations: [
        meta('app/001-description-required', {
          from: { collection: 'Posts', field: 'meta.description', nullable: true },
          transform: (value) => value ?? 'filled',
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "description" FROM "Posts_meta"'), [
      Object.assign(Object.create(null), { description: 'filled' }),
    ]);
    await db.close();
  });
});
