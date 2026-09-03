import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../src/ohne/database/adapter.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidGet from '../../../../src/layer/api/collections/[collection]/[uuid].get.ts';
import uuidPatch from '../../../../src/layer/api/collections/[collection]/[uuid].patch.ts';
import translationsGet from '../../../../src/layer/api/collections/[collection]/[uuid]/translations.get.ts';
import listGet from '../../../../src/layer/api/collections/[collection]/index.get.ts';
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
    api: {
      read: { public: true, access: () => ({ where: { published: true } }) },
      update: { public: true, access: () => ({ where: { published: true } }) },
    },
    fields: {
      title: field('text', { translatable: true }),
      published: field('boolean', { translatable: true }),
    },
  },
});
useCollections().register('TrOwned', {
  name: 'TrOwned',
  collection: {
    api: { read: { public: true, access: () => ({ where: { owner: 'me' } }) } },
    fields: { title: field('text', { translatable: true }), owner: field('text') },
  },
});
useCollections().register('TrLinks', {
  name: 'TrLinks',
  collection: {
    api: { read: 'public' },
    fields: { label: field('text'), scoped: field('record', { collection: 'TrScoped' }) },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

let queries = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
    return db.query<T>(sql, params);
  },
  queryOne: (sql, params) => db.queryOne(sql, params),
  transaction: (fn) => db.transaction(fn),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
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
const owned = (await queryUntyped('TrOwned').createOrThrow({ title: 'Mine', owner: 'me' }))
  .UUID as string;
await queryUntyped('TrOwned').locale('de').where({ UUID: owned }).updateOrThrow({ title: 'Meins' });
const linked = (await queryUntyped('TrLinks').createOrThrow({ label: 'L', scoped: openAtEN }))
  .UUID as string;

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohne', handler: handler as AnyHandler };
}

const ROUTE = route('GET', '/collections/[collection]/[uuid]/translations', translationsGet);
const LIST = route('GET', '/collections/[collection]', listGet);
const RECORD = route('GET', '/collections/[collection]/[uuid]', uuidGet);
const PATCH = route('PATCH', '/collections/[collection]/[uuid]', uuidPatch);

async function send(
  target: Route,
  url: string,
  params: Record<string, string>,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const request = new Request(url, init);
  const { response } = await dispatch(target, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

function call(params: Record<string, string>, qs = ''): Promise<{ status: number; body: unknown }> {
  const url = `http://x.test/collections/${params.collection}/${params.uuid}/translations${qs}`;
  return send(ROUTE, url, params);
}

function heldBy(body: unknown): Record<string, string[]> {
  const rows = body as { UUID: string; _translations: string[] }[];
  return Object.fromEntries(rows.map((row) => [row.UUID, row._translations]));
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

describe('`_translations` under an access scope', () => {
  it('lists each record narrowed to the locales the scope admits it at', async () => {
    const { status, body } = await send(LIST, 'http://x.test/collections/tr-scoped', {
      collection: 'tr-scoped',
    });
    strictEqual(status, 200);
    deepStrictEqual(heldBy(body), { [openAtEN]: ['en'] });
  });

  it('lists a read away from the default locale with that locale alone', async () => {
    const { body } = await send(LIST, 'http://x.test/collections/tr-scoped?locale=de', {
      collection: 'tr-scoped',
    });
    deepStrictEqual(heldBy(body), { [openAtDE]: ['de'] });
  });

  it('narrows the paginated envelope the same way', async () => {
    const { body } = await send(LIST, 'http://x.test/collections/tr-scoped?page=1', {
      collection: 'tr-scoped',
    });
    deepStrictEqual(heldBy((body as { records: unknown }).records), { [openAtEN]: ['en'] });
  });

  it('narrows the by-UUID read', async () => {
    const { status, body } = await send(RECORD, `http://x.test/collections/tr-scoped/${openAtEN}`, {
      collection: 'tr-scoped',
      uuid: openAtEN,
    });
    strictEqual(status, 200);
    deepStrictEqual((body as { _translations: string[] })._translations, ['en']);
  });

  it('narrows the answered record of a patch', async () => {
    const { status, body } = await send(
      PATCH,
      `http://x.test/collections/tr-scoped/${openAtEN}`,
      { collection: 'tr-scoped', uuid: openAtEN },
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Open again' }),
      },
    );
    strictEqual(status, 200);
    deepStrictEqual((body as { _translations: string[] })._translations, ['en']);
  });

  it('probes no locale under a scope over plain columns', async () => {
    queries = 0;
    const { body } = await send(LIST, 'http://x.test/collections/tr-owned', {
      collection: 'tr-owned',
    });
    deepStrictEqual(heldBy(body), { [owned]: ['en', 'de'] });
    strictEqual(queries, 2);
  });
});

describe('populated targets under a reach', () => {
  it("narrows a populated target's _translations to the locales its scope admits", async () => {
    const url = `http://x.test/collections/tr-links/${linked}?populate=[scoped]`;
    const { status, body } = await send(RECORD, url, { collection: 'tr-links', uuid: linked });
    strictEqual(status, 200);
    const scoped = (body as { scoped: { _translations: string[] } }).scoped;
    deepStrictEqual(scoped._translations, ['en']);
  });
});
