import { deepStrictEqual, rejects } from 'node:assert';
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
import { translationLocales } from '../../../../src/ohne/query/read/translation-locales.ts';

useLayers().add({
  path: '/translation-locales-read',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('TLPosts', {
  name: 'TLPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
    },
  },
});
useCollections().register('TLNotes', {
  name: 'TLNotes',
  collection: {
    fields: {
      name: field('text'),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('TLPlain', {
  name: 'TLPlain',
  collection: { fields: { label: field('text') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function create(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

async function translate(uuid: string, locale: string, title: string): Promise<void> {
  await queryUntyped('TLPosts').locale(locale).where({ UUID: uuid }).updateOrThrow({ title });
}

describe('translationLocales', () => {
  it('reports the default locale for an unlocaled create', async () => {
    const uuid = await create('TLPosts', { title: 'First', views: 1 });
    deepStrictEqual(await translationLocales('TLPosts', uuid), ['en']);
  });

  it('reports only the chain locale for a locale-scoped create', async () => {
    const record = await queryUntyped('TLPosts').locale('de').createOrThrow({
      title: 'Erste',
      views: 2,
    });
    deepStrictEqual(await translationLocales('TLPosts', record.UUID as string), ['de']);
  });

  it('materializes a locale on an update at it', async () => {
    const uuid = await create('TLPosts', { title: 'Second', views: 3 });
    await translate(uuid, 'de', 'Zweite');
    deepStrictEqual(await translationLocales('TLPosts', uuid), ['en', 'de']);
  });

  it('drops a locale deleteTranslation removed', async () => {
    const uuid = await create('TLPosts', { title: 'Third', views: 4 });
    await translate(uuid, 'de', 'Dritte');
    await queryUntyped('TLPosts').locale('de').where({ UUID: uuid }).deleteTranslation();
    deepStrictEqual(await translationLocales('TLPosts', uuid), ['en']);
  });

  it('orders by the configured locale order, not the write order', async () => {
    const uuid = await create('TLPosts', { title: 'Fourth', views: 5 });
    await translate(uuid, 'fr', 'Quatrieme');
    await translate(uuid, 'de', 'Vierte');
    deepStrictEqual(await translationLocales('TLPosts', uuid), ['en', 'de', 'fr']);
  });

  it('reports locales held only by locale-scoped derived rows', async () => {
    const uuid = await create('TLNotes', {
      name: 'note',
      sections: [{ heading: 'S1' }],
    });
    deepStrictEqual(await translationLocales('TLNotes', uuid), ['en']);
    await queryUntyped('TLNotes')
      .locale('de')
      .where({ UUID: uuid })
      .updateOrThrow({
        sections: [{ heading: 'DE-S1' }],
      });
    deepStrictEqual(await translationLocales('TLNotes', uuid), ['en', 'de']);
  });

  it('reports nothing for a record with no locale rows anywhere', async () => {
    const uuid = await create('TLNotes', { name: 'bare' });
    deepStrictEqual(await translationLocales('TLNotes', uuid), []);
  });

  it('never surfaces a leftover row at an unconfigured locale', async () => {
    const uuid = await create('TLPosts', { title: 'Fifth', views: 6 });
    await db.run(
      'INSERT INTO "TLPosts__translations" ("_parentUUID","_localeCode","title") VALUES (?,?,?)',
      [uuid, 'xx', 'Legacy'],
    );
    deepStrictEqual(await translationLocales('TLPosts', uuid), ['en']);
  });

  it('throws on a non-translatable collection', async () => {
    await rejects(() => translationLocales('TLPlain', 'missing'));
  });
});
