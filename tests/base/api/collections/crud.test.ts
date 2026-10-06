import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import uuidGet from '../../../../src/base/api/collections/[collection]/[uuid].get.ts';
import uuidPatch from '../../../../src/base/api/collections/[collection]/[uuid].patch.ts';
import listGet from '../../../../src/base/api/collections/[collection]/index.get.ts';
import createPost from '../../../../src/base/api/collections/[collection]/index.post.ts';
import queryPost from '../../../../src/base/api/collections/[collection]/query.post.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { unauthorized } from '../../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';

usePrinter().configure({ stream: { write: () => true } });

useCollections().register('CrudAuthors', {
  name: 'CrudAuthors',
  collection: { api: { read: 'public' }, fields: { name: field('text') } },
});
useCollections().register('CrudHidden', {
  name: 'CrudHidden',
  collection: { fields: { name: field('text') } },
});
useCollections().register('CrudPosts', {
  name: 'CrudPosts',
  collection: {
    api: { read: 'public', create: 'public', update: 'public', delete: 'public' },
    fields: {
      title: field('text'),
      secret: field('text', { readable: false, nullable: true }),
      kind: field('text', { writable: false, default: 'article' }),
      slug: field('text', { immutable: true }),
      author: field('record', { collection: 'CrudAuthors' }),
    },
  },
});
useCollections().register('CrudMany', {
  name: 'CrudMany',
  collection: { api: { read: 'public' }, fields: { n: field('integer') } },
});
useCollections().register('CrudTwoWord', {
  name: 'CrudTwoWord',
  collection: {
    api: { read: 'public', create: 'public', update: 'public', delete: 'public' },
    fields: { title: field('text') },
  },
});
useCollections().register('CrudClosed', {
  name: 'CrudClosed',
  collection: { api: { read: 'public' }, fields: { title: field('text') } },
});
useCollections().register('CrudGuarded', {
  name: 'CrudGuarded',
  collection: {
    api: {
      read: { public: true, middleware: ['crud-note'] },
      update: { public: true, middleware: ['crud-deny'] },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('CrudBroken', {
  name: 'CrudBroken',
  collection: {
    api: { read: { public: true, middleware: ['crud-ghost'] } },
    fields: { title: field('text') },
  },
});

useCollections().register('CrudRich', {
  name: 'CrudRich',
  collection: { api: { create: 'public' }, fields: { body: field('richText') } },
});

useCollections().register('CrudSettings', {
  name: 'CrudSettings',
  collection: {
    singleton: true,
    api: { read: 'public', update: 'public' },
    fields: { title: field('text', { default: 'My site' }) },
  },
});

useMiddleware().register('crud-deny', () => unauthorized());
useMiddleware().register('crud-note', () => undefined);

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function seed(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

const anduin = await seed('CrudAuthors', { name: 'Anduin' });
const sel = await seed('CrudPosts', { title: 'Sel', secret: 'hush', slug: 'sel', author: anduin });
for (let n = 1; n <= 25; n++) await seed('CrudMany', { n });
await runCreate('CrudSettings', {}, null);

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const ROUTES = {
  list: route('GET', '/collections/[collection]', listGet),
  query: route('POST', '/collections/[collection]/query', queryPost),
  create: route('POST', '/collections/[collection]', createPost),
  read: route('GET', '/collections/[collection]/[uuid]', uuidGet),
  patch: route('PATCH', '/collections/[collection]/[uuid]', uuidPatch),
  del: route('DELETE', '/collections/[collection]/[uuid]', uuidDelete),
};

interface CallResult {
  status: number;
  body: unknown;
  event: Awaited<ReturnType<typeof dispatch>>['event'];
}

async function call(
  r: Route,
  params: Record<string, string>,
  init: { body?: unknown; qs?: string } = {},
): Promise<CallResult> {
  const url = `http://x.test/collections/${params.collection}${init.qs ?? ''}`;
  const request = new Request(url, {
    method: r.method ?? 'GET',
    ...(init.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
  });
  const { response, event } = await dispatch(r, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text), event };
}

function wireData(body: unknown): { code?: string; path?: string } {
  return (body as { data?: { code?: string; path?: string } }).data ?? {};
}

function errorsOf(body: unknown): Record<string, string> {
  return (body as { data: { errors: Record<string, string> } }).data.errors;
}

const posts = { collection: 'crud-posts' };
const rich = { collection: 'crud-rich' };
const many = { collection: 'crud-many' };

describe('create', () => {
  it('answers 201 with the record, hiding readable: false fields', async () => {
    const { status, body } = await call(ROUTES.create, posts, {
      body: { title: 'One', secret: 's3cret', slug: 'one', author: anduin },
    });
    strictEqual(status, 201);
    const record = body as Record<string, unknown>;
    strictEqual(typeof record.UUID, 'string');
    strictEqual(record.title, 'One');
    strictEqual(record.slug, 'one');
    strictEqual(record.kind, 'article');
    ok(!('secret' in record));
  });

  it('rejects an unknown search param', async () => {
    const { status, body } = await call(ROUTES.create, posts, { qs: '?foo=1' });
    strictEqual(status, 400);
    deepStrictEqual(wireData(body), { code: 'unknownParam', path: 'foo' });
  });

  it('rejects locale on a non-translatable collection for reads and writes', async () => {
    const write = await call(ROUTES.create, posts, { qs: '?locale=en' });
    strictEqual(write.status, 400);
    deepStrictEqual(wireData(write.body), { code: 'localeNotApplicable', path: 'locale' });

    const read = await call(ROUTES.list, posts, { qs: '?locale=en' });
    strictEqual(read.status, 400);
    deepStrictEqual(wireData(read.body), { code: 'localeNotApplicable', path: 'locale' });
  });

  it('rejects an unsafe link as 422 at its path inside the value', async () => {
    const { status, body } = await call(ROUTES.create, rich, {
      body: {
        body: [{ kind: 'paragraph', content: [{ text: 'x', link: { url: 'javascript:x' } }] }],
      },
    });
    strictEqual(status, 422);
    deepStrictEqual(Object.keys(errorsOf(body)), ['body[0].content[0].link.url']);
  });

  it('rejects a body nested deeper than 32 levels as 400', async () => {
    let deep: unknown = 1;
    for (let level = 0; level < 33; level++) deep = { body: deep };
    const { status, body } = await call(ROUTES.create, rich, { body: deep });
    strictEqual(status, 400);
    strictEqual((body as { message: string }).message, 'api.body.tooNested');
  });

  it('denies a writable: false key as 422, byte-identical to an unknown key', async () => {
    const denied = await call(ROUTES.create, posts, {
      body: { title: 'X', slug: 'x', kind: 'page' },
    });
    strictEqual(denied.status, 422);
    deepStrictEqual(Object.keys(errorsOf(denied.body)), ['kind']);

    const unknown = await call(ROUTES.create, posts, {
      body: { title: 'X', slug: 'x2', nope: 'z' },
    });
    strictEqual(unknown.status, 422);
    deepStrictEqual(Object.keys(errorsOf(unknown.body)), ['nope']);
    strictEqual(errorsOf(unknown.body).nope, errorsOf(denied.body).kind);
  });
});

describe('list', () => {
  it('answers the plain array, hiding readable: false fields', async () => {
    const { status, body } = await call(ROUTES.list, posts);
    strictEqual(status, 200);
    ok(Array.isArray(body));
    const records = body as Record<string, unknown>[];
    ok(records.length >= 1);
    ok(records.every((record) => !('secret' in record)));
    ok(records.some((record) => record.title === 'Sel'));
  });

  it('paginates page without perPage at 20 per page', async () => {
    const { status, body } = await call(ROUTES.list, many, { qs: '?page=2' });
    strictEqual(status, 200);
    const page = body as {
      records: unknown[];
      total: number;
      page: number;
      perPage: number;
      lastPage: number;
    };
    strictEqual(page.total, 25);
    strictEqual(page.page, 2);
    strictEqual(page.perPage, 20);
    strictEqual(page.lastPage, 2);
    strictEqual(page.records.length, 5);
  });

  it('reads identically through the POST body query', async () => {
    const got = await call(ROUTES.list, many, { qs: '?order=n' });
    const queried = await call(ROUTES.query, many, { body: { order: 'n' } });
    strictEqual(got.status, 200);
    strictEqual(queried.status, 200);
    ok(Array.isArray(got.body));
    strictEqual((got.body as unknown[]).length, 25);
    deepStrictEqual(queried.body, got.body);
  });

  it('rejects URL params on the body query', async () => {
    const { status, body } = await call(ROUTES.query, many, { qs: '?limit=5' });
    strictEqual(status, 400);
    deepStrictEqual(wireData(body), { code: 'unknownParam', path: 'limit' });
  });
});

describe('list under a lowered `maxLimit`', () => {
  before(() =>
    useLayers().add({ path: '/crud-max-limit', input: { query: { guards: { maxLimit: 3 } } } }),
  );
  after(() => useLayers().remove('/crud-max-limit'));

  it('stops an unpaged read at `maxLimit`', async () => {
    for (const qs of ['', '?limit=10', '?offset=1']) {
      const { status, body } = await call(ROUTES.list, many, { qs });
      strictEqual(status, 200);
      strictEqual((body as unknown[]).length, 3);
    }
  });

  it('stops an unpaged body query at `maxLimit`', async () => {
    for (const body of [{}, { limit: 10 }, { offset: 1 }]) {
      const queried = await call(ROUTES.query, many, { body });
      strictEqual(queried.status, 200);
      strictEqual((queried.body as unknown[]).length, 3);
    }
  });

  it('pages past `maxLimit` with `perPage`', async () => {
    const got = await call(ROUTES.list, many, { qs: '?page=1&perPage=5' });
    const queried = await call(ROUTES.query, many, { body: { page: 1, perPage: 5 } });
    for (const { status, body } of [got, queried]) {
      strictEqual(status, 200);
      strictEqual((body as { records: unknown[] }).records.length, 5);
    }
  });
});

describe('read one', () => {
  it('reads by UUID, hiding readable: false fields', async () => {
    const { status, body } = await call(ROUTES.read, { ...posts, uuid: sel });
    strictEqual(status, 200);
    const record = body as Record<string, unknown>;
    strictEqual(record.title, 'Sel');
    strictEqual(record.author, anduin);
    ok(!('secret' in record));
  });

  it('shapes with select and populate', async () => {
    const selected = await call(ROUTES.read, { ...posts, uuid: sel }, { qs: '?select=[title]' });
    strictEqual(selected.status, 200);
    deepStrictEqual(selected.body, { title: 'Sel' });

    const populated = await call(ROUTES.read, { ...posts, uuid: sel }, { qs: '?populate=author' });
    strictEqual(populated.status, 200);
    const author = (populated.body as { author: Record<string, unknown> }).author;
    strictEqual(author.name, 'Anduin');
    strictEqual(author.UUID, anduin);
  });

  it('404s a missing UUID', async () => {
    strictEqual((await call(ROUTES.read, { ...posts, uuid: 'missing' })).status, 404);
  });

  it('rejects filtering, ordering, and windowing params', async () => {
    for (const qs of ['?where={title:Sel}', '?order=title', '?limit=5']) {
      const { status, body } = await call(ROUTES.read, { ...posts, uuid: sel }, { qs });
      strictEqual(status, 400);
      deepStrictEqual(wireData(body), { code: 'unknownParam', path: qs.slice(1).split('=')[0] });
    }
  });
});

describe('update', () => {
  it('patches and returns the record', async () => {
    const uuid = await seed('CrudPosts', { title: 'P1', slug: 'p1', author: anduin });
    const { status, body } = await call(
      ROUTES.patch,
      { ...posts, uuid },
      { body: { title: 'P2' } },
    );
    strictEqual(status, 200);
    const record = body as Record<string, unknown>;
    strictEqual(record.UUID, uuid);
    strictEqual(record.title, 'P2');
    ok(!('secret' in record));
  });

  it('404s a missing UUID', async () => {
    const { status } = await call(
      ROUTES.patch,
      { ...posts, uuid: 'missing' },
      { body: { title: 'x' } },
    );
    strictEqual(status, 404);
  });

  it('denies immutable and writable: false keys as 422 at their paths', async () => {
    const { status, body } = await call(
      ROUTES.patch,
      { ...posts, uuid: sel },
      { body: { slug: 'new', kind: 'page' } },
    );
    strictEqual(status, 422);
    deepStrictEqual(Object.keys(errorsOf(body)).sort(), ['kind', 'slug']);
  });
});

describe('delete', () => {
  it('rejects params before deleting, then 204s and 404s a repeat', async () => {
    const uuid = await seed('CrudPosts', { title: 'D1', slug: 'd1', author: anduin });
    const rejected = await call(ROUTES.del, { ...posts, uuid }, { qs: '?foo=1' });
    strictEqual(rejected.status, 400);
    deepStrictEqual(wireData(rejected.body), { code: 'unknownParam', path: 'foo' });
    ok(await queryUntyped('CrudPosts').where({ UUID: uuid }).findFirst());

    const deleted = await call(ROUTES.del, { ...posts, uuid });
    strictEqual(deleted.status, 204);
    strictEqual(deleted.body, null);
    strictEqual((await call(ROUTES.del, { ...posts, uuid })).status, 404);
  });
});

describe('gate', () => {
  it('closes operations individually under a partial api', async () => {
    const open = await call(ROUTES.list, { collection: 'crud-closed' });
    strictEqual(open.status, 200);
    strictEqual((await call(ROUTES.create, { collection: 'crud-closed' })).status, 404);
  });

  it('answers identical 404 bodies for unknown, unexposed, and closed', async () => {
    const unknown = await call(ROUTES.list, { collection: 'crud-nope' });
    const unexposed = await call(ROUTES.list, { collection: 'crud-hidden' });
    const closed = await call(ROUTES.create, { collection: 'crud-closed' });
    strictEqual(unknown.status, 404);
    strictEqual(unexposed.status, 404);
    strictEqual(closed.status, 404);
    deepStrictEqual(unexposed.body, unknown.body);
    deepStrictEqual(closed.body, unknown.body);
  });

  it('opens every public operation, resolved by kebab-case name', async () => {
    const p = { collection: 'crud-two-word' };
    strictEqual((await call(ROUTES.list, { collection: 'CrudTwoWord' })).status, 404);

    const created = await call(ROUTES.create, p, { body: { title: 'T' } });
    strictEqual(created.status, 201);
    const uuid = (created.body as { UUID: string }).UUID;

    const listed = await call(ROUTES.list, p);
    strictEqual(listed.status, 200);
    strictEqual((listed.body as unknown[]).length, 1);

    const patched = await call(ROUTES.patch, { ...p, uuid }, { body: { title: 'U' } });
    strictEqual(patched.status, 200);
    strictEqual((patched.body as { title: string }).title, 'U');

    strictEqual((await call(ROUTES.del, { ...p, uuid })).status, 204);
  });

  it('lets a middleware answer, recording it on the event', async () => {
    const { status, event } = await call(ROUTES.patch, { collection: 'crud-guarded', uuid: 'x' });
    strictEqual(status, 401);
    deepStrictEqual(event.appliedMiddleware, ['crud-deny']);
  });

  it('runs pass-through middleware before the operation', async () => {
    const { status, body, event } = await call(ROUTES.list, { collection: 'crud-guarded' });
    strictEqual(status, 200);
    deepStrictEqual(body, []);
    deepStrictEqual(event.appliedMiddleware, ['crud-note']);
  });

  it('500s an unknown middleware name', async () => {
    const { status, body } = await call(ROUTES.list, { collection: 'crud-broken' });
    strictEqual(status, 500);
    strictEqual((body as { statusCode: number }).statusCode, 500);
  });
});

describe('singleton', () => {
  const settings = { collection: 'crud-settings' };

  it('lists its one record and patches it by UUID', async () => {
    const listed = await call(ROUTES.list, settings);
    strictEqual(listed.status, 200);
    const records = listed.body as { UUID: string; title: string }[];
    strictEqual(records.length, 1);
    strictEqual(records[0].title, 'My site');

    const patched = await call(
      ROUTES.patch,
      { ...settings, uuid: records[0].UUID },
      { body: { title: 'ohne' } },
    );
    strictEqual(patched.status, 200);
    strictEqual((patched.body as { title: string }).title, 'ohne');
  });

  it('answers the closed-operation 404 for create and delete', async () => {
    const [record] = await queryUntyped('CrudSettings').findMany();
    const created = await call(ROUTES.create, settings, { body: { title: 'Second' } });
    strictEqual(created.status, 404);
    const deleted = await call(ROUTES.del, { ...settings, uuid: record.UUID as string });
    strictEqual(deleted.status, 404);
    strictEqual(await queryUntyped('CrudSettings').count(), 1);
  });
});
