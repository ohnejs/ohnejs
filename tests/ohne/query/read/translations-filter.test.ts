import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UntypedQueryBuilder } from '../../../../src/ohne/query/untyped.ts';

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
  path: '/translations-filter',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('TFTags', {
  name: 'TFTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('TFPosts', {
  name: 'TFPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
      tags: field('records', { collection: 'TFTags', translatable: true }),
    },
  },
});
useCollections().register('TFComments', {
  name: 'TFComments',
  collection: {
    fields: { body: field('text'), post: field('record', { collection: 'TFPosts' }) },
  },
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

async function translate(
  uuid: string,
  locale: string,
  input: Record<string, unknown>,
): Promise<void> {
  await queryUntyped('TFPosts').locale(locale).where({ UUID: uuid }).updateOrThrow(input);
}

const red = await create('TFTags', { label: 'red' });

const onlyEN = await create('TFPosts', { title: 'Only', views: 1 });
const titled = await create('TFPosts', { title: 'Titled', views: 2 });
await translate(titled, 'de', { title: 'Betitelt' });
const linked = await create('TFPosts', { title: 'Linked', views: 3 });
await translate(linked, 'de', { tags: [red] });
const everywhere = await create('TFPosts', { title: 'Everywhere', views: 4 });
await translate(everywhere, 'de', { title: 'Ueberall' });
await translate(everywhere, 'fr', { title: 'Partout' });

const onTitled = await create('TFComments', { body: 'on titled', post: titled });
await create('TFComments', { body: 'on only', post: onlyEN });

const posts = (): UntypedQueryBuilder => queryUntyped('TFPosts');

async function uuids(builder: UntypedQueryBuilder): Promise<unknown[]> {
  return (await builder.orderBy('views').findMany()).map((row) => row.UUID);
}

describe('filtering by `_translations`', () => {
  it('`includes` matches the records translated at the locale', async () => {
    deepStrictEqual(await uuids(posts().where({ _translations: { includes: 'de' } })), [
      titled,
      linked,
      everywhere,
    ]);
    deepStrictEqual(await uuids(posts().where({ _translations: { includes: 'fr' } })), [
      everywhere,
    ]);
  });

  it('`not.includes` matches what is left to translate', async () => {
    deepStrictEqual(await uuids(posts().where({ _translations: { not: { includes: 'de' } } })), [
      onlyEN,
    ]);
  });

  it('a `not` group negates it the same way, the shape the dashboard filter emits', async () => {
    deepStrictEqual(await uuids(posts().where({ not: { _translations: { includes: 'de' } } })), [
      onlyEN,
    ]);
  });

  it('`includesAll` and `includesAny` read the list as a read returns it', async () => {
    deepStrictEqual(await uuids(posts().where({ _translations: { includesAll: ['de', 'fr'] } })), [
      everywhere,
    ]);
    deepStrictEqual(await uuids(posts().where({ _translations: { includesAny: ['de', 'fr'] } })), [
      titled,
      linked,
      everywhere,
    ]);
    deepStrictEqual(
      await uuids(posts().where({ _translations: { not: { includesAll: ['en', 'de'] } } })),
      [onlyEN],
    );
  });

  it('agrees with the list every matched record reads', async () => {
    for (const locale of ['en', 'de', 'fr']) {
      const matched = await posts()
        .where({ _translations: { includes: locale } })
        .findMany();
      const all = await posts().findMany();
      deepStrictEqual(
        matched.map((row) => row.UUID).sort(),
        all
          .filter((row) => (row._translations as string[]).includes(locale))
          .map((row) => row.UUID)
          .sort(),
      );
    }
  });

  it('counts a locale held through a relation alone, where a null title would not', async () => {
    const record = await posts().locale('de').where({ UUID: linked }).findFirst();
    strictEqual(record?.title, null);
    deepStrictEqual(record._translations, ['en', 'de']);
    ok((await uuids(posts().where({ _translations: { includes: 'de' } }))).includes(linked));
  });

  it('answers alike whatever locale the chain reads', async () => {
    deepStrictEqual(
      await uuids(
        posts()
          .locale('fr')
          .where({ _translations: { includes: 'de' } }),
      ),
      await uuids(posts().where({ _translations: { includes: 'de' } })),
    );
  });

  it('a locale the configuration does not name matches nothing', async () => {
    deepStrictEqual(await uuids(posts().where({ _translations: { includes: 'es' } })), []);
    strictEqual(
      (await uuids(posts().where({ _translations: { not: { includes: 'es' } } }))).length,
      4,
    );
  });

  it('composes with other conditions, `count`, and `paginate`', async () => {
    const untranslated = posts().where({ _translations: { not: { includes: 'fr' } } });
    strictEqual(await untranslated.count(), 3);
    const page = await posts()
      .where({ _translations: { includes: 'de' }, views: { atLeast: 3 } })
      .orderBy('views')
      .paginate(1, 1);
    strictEqual(page.total, 2);
    deepStrictEqual(
      page.records.map((row) => row.UUID),
      [linked],
    );
  });

  it('filters through a `has` probe on the target', async () => {
    const comments = await queryUntyped('TFComments')
      .where({ post: { has: { _translations: { includes: 'de' } } } })
      .findMany();
    deepStrictEqual(
      comments.map((row) => row.UUID),
      [onTitled],
    );
  });

  it('narrows an update and a delete like any other filter', async () => {
    await posts()
      .where({ _translations: { includes: 'fr' } })
      .updateOrThrow({ views: 40 });
    const views = await posts().orderBy('views').pluck('views');
    deepStrictEqual(views, [1, 2, 3, 40]);

    const temp = await create('TFPosts', { title: 'Temp', views: 99 });
    await translate(temp, 'de', { title: 'Temporaer' });
    await posts()
      .where({ _translations: { includesAll: ['en', 'de'] }, views: 99 })
      .delete();
    strictEqual(await posts().where({ UUID: temp }).count(), 0);
    strictEqual(await posts().count(), 4);
  });

  it('refuses any other operator', async () => {
    for (const where of [{ _translations: 'de' }, { _translations: { empty: true } }]) {
      let message = '';
      try {
        await posts().where(where).findMany();
      } catch (error) {
        message = (error as Error).message;
      }
      ok(message.includes('_translations'), message);
    }
  });
});
