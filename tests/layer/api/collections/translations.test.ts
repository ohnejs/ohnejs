import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import translationsGet from '../../../../src/layer/api/collections/[collection]/[uuid]/translations.get.ts';
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
  path: '/translations-route',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('TrPosts', {
  name: 'TrPosts',
  collection: {
    api: { read: 'public' },
    fields: { title: field('text', { translatable: true }) },
  },
});
useCollections().register('TrPlain', {
  name: 'TrPlain',
  collection: { api: { read: 'public' }, fields: { label: field('text') } },
});
useCollections().register('TrGuarded', {
  name: 'TrGuarded',
  collection: { api: { read: true }, fields: { title: field('text', { translatable: true }) } },
});
useCollections().register('TrScoped', {
  name: 'TrScoped',
  collection: {
    api: { read: { public: true, access: () => ({ where: { published: true } }) } },
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

const post = (await queryUntyped('TrPosts').createOrThrow({ title: 'First' })).UUID as string;
await queryUntyped('TrPosts').locale('de').where({ UUID: post }).updateOrThrow({ title: 'Erste' });
const plain = (await queryUntyped('TrPlain').createOrThrow({ label: 'flat' })).UUID as string;

const scoped = queryUntyped('TrScoped');
const openAtEN = (await scoped.createOrThrow({ title: 'Open', published: true })).UUID as string;
await queryUntyped('TrScoped')
  .locale('de')
  .where({ UUID: openAtEN })
  .updateOrThrow({ title: 'Offen', published: false });
const openAtDE = (
  await queryUntyped('TrScoped').locale('de').createOrThrow({ title: 'Nur DE', published: true })
).UUID as string;
const hidden = (await queryUntyped('TrScoped').createOrThrow({ title: 'Hidden', published: false }))
  .UUID as string;

const ROUTE: Route = {
  method: 'GET',
  pattern: '/collections/[collection]/[uuid]/translations',
  file: '/collections/[collection]/[uuid]/translations.ts',
  layer: 'ohne',
  handler: translationsGet as AnyHandler,
};

async function call(
  params: Record<string, string>,
  qs = '',
): Promise<{ status: number; body: unknown }> {
  const url = `http://x.test/collections/${params.collection}/${params.uuid}/translations${qs}`;
  const request = new Request(url);
  const { response } = await dispatch(ROUTE, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

describe('GET /collections/[collection]/[uuid]/translations', () => {
  it('answers the held locales in the configured order', async () => {
    const { status, body } = await call({ collection: 'tr-posts', uuid: post });
    strictEqual(status, 200);
    deepStrictEqual(body, { locales: ['en', 'de'] });
  });

  it('404s a non-translatable collection', async () => {
    strictEqual((await call({ collection: 'tr-plain', uuid: plain })).status, 404);
  });

  it('404s an unknown UUID', async () => {
    strictEqual((await call({ collection: 'tr-posts', uuid: 'missing' })).status, 404);
  });

  it('rejects any query param', async () => {
    const { status, body } = await call({ collection: 'tr-posts', uuid: post }, '?foo=1');
    strictEqual(status, 400);
    deepStrictEqual((body as { data?: unknown }).data, { code: 'unknownParam', path: 'foo' });
  });

  it('401s a guarded read without a user', async () => {
    strictEqual((await call({ collection: 'tr-guarded', uuid: post })).status, 401);
  });

  it('lists only the locales a scope `where` admits', async () => {
    const { status, body } = await call({ collection: 'tr-scoped', uuid: openAtEN });
    strictEqual(status, 200);
    deepStrictEqual(body, { locales: ['en'] });
  });

  it('answers a record the scope admits only away from the default locale', async () => {
    const { status, body } = await call({ collection: 'tr-scoped', uuid: openAtDE });
    strictEqual(status, 200);
    deepStrictEqual(body, { locales: ['de'] });
  });

  it('404s a record the scope hides at every locale', async () => {
    strictEqual((await call({ collection: 'tr-scoped', uuid: hidden })).status, 404);
  });
});
