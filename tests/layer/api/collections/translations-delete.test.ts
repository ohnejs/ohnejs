import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import translationsDelete from '../../../../src/layer/api/collections/[collection]/[uuid]/translations.delete.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({
  path: '/translations-delete-route',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('TDPosts', {
  name: 'TDPosts',
  collection: {
    api: { read: 'public', delete: 'public' },
    fields: { title: field('text', { translatable: true }) },
  },
});
useCollections().register('TDPlain', {
  name: 'TDPlain',
  collection: { api: { delete: 'public' }, fields: { label: field('text') } },
});
useCollections().register('TDGuarded', {
  name: 'TDGuarded',
  collection: { api: { delete: true }, fields: { title: field('text', { translatable: true }) } },
});
useCollections().register('TDClosed', {
  name: 'TDClosed',
  collection: {
    api: { read: 'public' },
    fields: { title: field('text', { translatable: true }) },
  },
});
useCollections().register('TDScoped', {
  name: 'TDScoped',
  collection: {
    api: { delete: { public: true, access: () => ({ where: { published: true } }) } },
    fields: {
      title: field('text', { translatable: true }),
      published: field('boolean', { translatable: true }),
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

async function seedPost(title: string, german: string): Promise<string> {
  const uuid = (await queryUntyped('TDPosts').createOrThrow({ title })).UUID as string;
  await queryUntyped('TDPosts').locale('de').where({ UUID: uuid }).updateOrThrow({ title: german });
  return uuid;
}

const plain = (await queryUntyped('TDPlain').createOrThrow({ label: 'flat' })).UUID as string;
const scoped = (await queryUntyped('TDScoped').createOrThrow({ title: 'Open', published: true }))
  .UUID as string;
await queryUntyped('TDScoped')
  .locale('de')
  .where({ UUID: scoped })
  .updateOrThrow({ title: 'Offen', published: false });

const ROUTE: Route = {
  method: 'DELETE',
  pattern: '/collections/[collection]/[uuid]/translations',
  file: '/collections/[collection]/[uuid]/translations.ts',
  layer: 'ohne',
  handler: translationsDelete as AnyHandler,
};

async function call(
  params: Record<string, string>,
  qs = '',
): Promise<{ status: number; body: unknown }> {
  const url = `http://x.test/collections/${params.collection}/${params.uuid}/translations${qs}`;
  const request = new Request(url, { method: 'DELETE' });
  const { response } = await dispatch(ROUTE, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function titleAt(collection: string, uuid: string, locale: string): Promise<unknown> {
  const record = await queryUntyped(collection).locale(locale).where({ UUID: uuid }).findFirst();
  return record?.title;
}

describe('DELETE /collections/[collection]/[uuid]/translations', () => {
  it('deletes the named locale and answers 204, the record and other locales surviving', async () => {
    const uuid = await seedPost('First', 'Erste');
    const { status, body } = await call({ collection: 'td-posts', uuid }, '?locale=de');
    strictEqual(status, 204);
    strictEqual(body, null);
    strictEqual(await titleAt('TDPosts', uuid, 'de'), null);
    strictEqual(await titleAt('TDPosts', uuid, 'en'), 'First');
  });

  it('defaults to the default locale when no `locale` is given', async () => {
    const uuid = await seedPost('Second', 'Zweite');
    strictEqual((await call({ collection: 'td-posts', uuid })).status, 204);
    strictEqual(await titleAt('TDPosts', uuid, 'en'), null);
    strictEqual(await titleAt('TDPosts', uuid, 'de'), 'Zweite');
  });

  it('404s a locale the record holds nothing at', async () => {
    const uuid = await seedPost('Third', 'Dritte');
    strictEqual((await call({ collection: 'td-posts', uuid }, '?locale=fr')).status, 404);
  });

  it('404s an unknown UUID', async () => {
    strictEqual((await call({ collection: 'td-posts', uuid: 'missing' })).status, 404);
  });

  it('404s a non-translatable collection', async () => {
    strictEqual((await call({ collection: 'td-plain', uuid: plain }, '?locale=de')).status, 404);
  });

  it('404s a collection whose delete is closed', async () => {
    const uuid = (await queryUntyped('TDClosed').createOrThrow({ title: 'Shut' })).UUID as string;
    strictEqual((await call({ collection: 'td-closed', uuid }, '?locale=de')).status, 404);
  });

  it('rejects an unknown param', async () => {
    const uuid = await seedPost('Fourth', 'Vierte');
    const { status, body } = await call({ collection: 'td-posts', uuid }, '?foo=1');
    strictEqual(status, 400);
    deepStrictEqual((body as { data?: unknown }).data, { code: 'unknownParam', path: 'foo' });
  });

  it('rejects an unknown locale', async () => {
    const uuid = await seedPost('Fifth', 'Fünfte');
    const { status, body } = await call({ collection: 'td-posts', uuid }, '?locale=zz');
    strictEqual(status, 400);
    deepStrictEqual((body as { data?: unknown }).data, { code: 'invalidLocale', path: 'locale' });
  });

  it('401s a guarded delete without a user', async () => {
    const uuid = (await queryUntyped('TDGuarded').createOrThrow({ title: 'Locked' }))
      .UUID as string;
    strictEqual((await call({ collection: 'td-guarded', uuid }, '?locale=de')).status, 401);
  });

  it('404s a record the scope hides at the target locale', async () => {
    strictEqual((await call({ collection: 'td-scoped', uuid: scoped }, '?locale=de')).status, 404);
    strictEqual(await titleAt('TDScoped', scoped, 'de'), 'Offen');
  });

  it('deletes at a locale the scope admits', async () => {
    strictEqual((await call({ collection: 'td-scoped', uuid: scoped }, '?locale=en')).status, 204);
    strictEqual(await titleAt('TDScoped', scoped, 'en'), null);
  });
});
