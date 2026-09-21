import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useLayers().add({
  path: '/locale-create',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('LCUsers', {
  name: 'LCUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('LCTags', {
  name: 'LCTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('LCPosts', {
  name: 'LCPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      summary: field('text', { translatable: true, default: 'draft' }),
      views: field('integer'),
      author: field('record', { collection: 'LCUsers', translatable: true }),
      tags: field('records', { collection: 'LCTags', translatable: true }),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});
await db.run('INSERT INTO "LCUsers" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'u1',
  1,
  'Anduin',
]);
await db.run('INSERT INTO "LCTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t1', 1, 'A']);
await db.run('INSERT INTO "LCTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t2', 1, 'B']);

describe('runCreate under locales', () => {
  it('writes the companion row at the default locale and stamps scoped rows', async () => {
    const result = await queryUntyped('LCPosts').create({
      title: 'Hello',
      views: 1,
      tags: ['t1'],
      sections: [{ heading: 'Intro' }],
    });
    ok(result.ok);
    const uuid = result.record.UUID as string;
    const companion = await db.query<{ _localeCode: string; title: string }>(
      'SELECT "_localeCode","title" FROM "LCPosts__translations" WHERE "_parentUUID" = ?',
      [uuid],
    );
    deepStrictEqual(
      companion.map((row) => ({ ...row })),
      [{ _localeCode: 'en', title: 'Hello' }],
    );
    const junction = await db.query<{ _localeCode: string }>(
      'SELECT "_localeCode" FROM "LCPosts_tags" WHERE "_parentUUID" = ?',
      [uuid],
    );
    deepStrictEqual(
      junction.map((row) => ({ ...row })),
      [{ _localeCode: 'en' }],
    );
    const sections = await db.query<{ _localeCode: string; heading: string }>(
      'SELECT "_localeCode","heading" FROM "LCPosts_sections" WHERE "_parentUUID" = ?',
      [uuid],
    );
    deepStrictEqual(
      sections.map((row) => ({ ...row })),
      [{ _localeCode: 'en', heading: 'Intro' }],
    );
  });

  it('stamps an explicit locale on every row and reads its values back', async () => {
    const result = await queryUntyped('LCPosts')
      .locale('de')
      .create({
        title: 'Hallo',
        views: 2,
        tags: ['t1'],
        sections: [{ heading: 'Einleitung' }],
      });
    ok(result.ok);
    strictEqual(result.record.title, 'Hallo');
    const uuid = result.record.UUID as string;
    for (const table of ['LCPosts__translations', 'LCPosts_tags', 'LCPosts_sections']) {
      const rows = await db.query<{ _localeCode: string }>(
        `SELECT "_localeCode" FROM "${table}" WHERE "_parentUUID" = ?`,
        [uuid],
      );
      deepStrictEqual(
        rows.map((row) => ({ ...row })),
        [{ _localeCode: 'de' }],
      );
    }
    const reread = await queryUntyped('LCPosts').locale('de').where({ UUID: uuid }).findFirst();
    ok(reread);
    strictEqual(reread.title, 'Hallo');
    deepStrictEqual(reread.tags, ['t1']);
    deepStrictEqual(
      (reread.sections as { heading: string }[]).map((section) => section.heading),
      ['Einleitung'],
    );
    const en = await queryUntyped('LCPosts').where({ UUID: uuid }).findFirst();
    strictEqual(en?.title, null);
  });

  it('fills an absent defaulted translatable field into the companion row', async () => {
    const result = await queryUntyped('LCPosts').create({ title: 'Bare', views: 3 });
    ok(result.ok);
    const rows = await db.query<{ summary: string }>(
      'SELECT "summary" FROM "LCPosts__translations" WHERE "_parentUUID" = ?',
      [result.record.UUID as string],
    );
    deepStrictEqual(
      rows.map((row) => ({ ...row })),
      [{ summary: 'draft' }],
    );
  });

  it('rejects a create missing a non-defaulted non-nullable translatable field', async () => {
    const result = await queryUntyped('LCPosts').create({ views: 4 });
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.required');
  });

  it('lands a translatable record value in the companion, not the main table', async () => {
    const result = await queryUntyped('LCPosts').create({ title: 'Ref', views: 5, author: 'u1' });
    ok(result.ok);
    const rows = await db.query<{ author: string }>(
      'SELECT "author" FROM "LCPosts__translations" WHERE "_parentUUID" = ?',
      [result.record.UUID as string],
    );
    deepStrictEqual(
      rows.map((row) => ({ ...row })),
      [{ author: 'u1' }],
    );
    const mainColumns = await db.query<{ name: string }>('PRAGMA table_info("LCPosts")');
    ok(!mainColumns.some((column) => column.name === 'author'));
  });

  it('rejects a missing translatable record reference at its field', async () => {
    const result = await queryUntyped('LCPosts').create({
      title: 'Ghost',
      views: 6,
      author: 'ghost',
    });
    ok(!result.ok);
    strictEqual(result.errors.author, 'validation.invalidReference');
  });

  it('appends junction positions per target and locale', async () => {
    const inputs = [
      { title: 'One', views: 7, tags: ['t2'] },
      { title: 'Two', views: 8, tags: ['t2'] },
    ];
    for (const input of inputs) ok((await queryUntyped('LCPosts').create(input)).ok);
    const third = await queryUntyped('LCPosts')
      .locale('de')
      .create({ title: 'Drei', views: 9, tags: ['t2'] });
    ok(third.ok);
    const rows = await db.query<{ _localeCode: string; _targetPosition: number }>(
      'SELECT "_localeCode","_targetPosition" FROM "LCPosts_tags" WHERE "_targetUUID" = ? ' +
        'ORDER BY "_localeCode","_targetPosition"',
      ['t2'],
    );
    deepStrictEqual(
      rows.map((row) => ({ ...row })),
      [
        { _localeCode: 'de', _targetPosition: 0 },
        { _localeCode: 'en', _targetPosition: 0 },
        { _localeCode: 'en', _targetPosition: 1 },
      ],
    );
  });
});
