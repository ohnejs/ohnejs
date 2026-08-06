import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { QueryScope } from '../../../../src/ohne/query/wire/apply.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../../src/layer/api/collections/[collection]/[uuid].delete.ts';
import uuidGet from '../../../../src/layer/api/collections/[collection]/[uuid].get.ts';
import uuidPatch from '../../../../src/layer/api/collections/[collection]/[uuid].patch.ts';
import listGet from '../../../../src/layer/api/collections/[collection]/index.get.ts';
import createPost from '../../../../src/layer/api/collections/[collection]/index.post.ts';
import queryPost from '../../../../src/layer/api/collections/[collection]/query.post.ts';
import { hashSessionToken } from '../../../../src/layer/auth/_token.ts';
import { useUser } from '../../../../src/layer/auth/use-user.ts';
import SessionsCollection from '../../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../../src/layer/collections/Users.ts';
import passwordField from '../../../../src/layer/fields/password.ts';
import rolesField from '../../../../src/layer/fields/roles.ts';
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
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import { isNull } from '../../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/access-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('notes-user', {
  name: 'notes-user',
  role: { capabilities: ['collection.AccessNotes.*'] },
});

const own = async (): Promise<QueryScope | boolean> => {
  const user = await useUser();
  return isNull(user) ? false : { where: { owner: user.UUID } };
};

let accessResolutions = 0;

useCollections().register('AccessNotes', {
  name: 'AccessNotes',
  collection: {
    api: {
      read: { access: own },
      create: { access: () => ({ where: { owner: 'no-such-owner' } }) },
      update: { access: own },
      delete: { access: own },
    },
    fields: { title: field('text'), owner: field('text') },
  },
});
useCollections().register('AccessDrafts', {
  name: 'AccessDrafts',
  collection: {
    api: {
      read: { public: true, access: () => ({ select: ['title'] }) },
      update: { public: true, access: () => ({ select: ['title'] }) },
    },
    fields: { title: field('text'), note: field('text') },
  },
});
useCollections().register('AccessGate', {
  name: 'AccessGate',
  collection: {
    api: {
      read: { public: true, access: async () => !isNull(await useUser()) },
      update: { access: () => false },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('AccessEmpty', {
  name: 'AccessEmpty',
  collection: {
    api: { read: { public: true, access: () => ({ select: [] }) } },
    fields: { title: field('text') },
  },
});
useCollections().register('AccessBlocked', {
  name: 'AccessBlocked',
  collection: {
    api: {
      read: {
        public: true,
        middleware: ['access-block'],
        access: () => ((accessResolutions += 1), true),
      },
    },
    fields: { title: field('text') },
  },
});

useMiddleware().register('access-block', () => unauthorized());

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return { uuid: record.UUID as string, token };
}

const anonymous = null;
const writer = await userWith('writer@example.com', ['notes-user']);
const other = await userWith('other@example.com', ['notes-user']);
const admin = await userWith('admin@example.com', ['admin']);

async function seed(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

const writerNote = await seed('AccessNotes', { title: 'Writer note', owner: writer.uuid });
const otherNote = await seed('AccessNotes', { title: 'Other note', owner: other.uuid });
const draft = await seed('AccessDrafts', { title: 'Draft', note: 'hidden' });
const gateRow = await seed('AccessGate', { title: 'Open' });

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohne', handler: handler as AnyHandler };
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
}

async function call(
  r: Route,
  params: Record<string, string>,
  bearer: string | null,
  init: { body?: unknown; qs?: string } = {},
): Promise<CallResult> {
  const path =
    `/collections/${params.collection}` +
    (params.uuid ? `/${params.uuid}` : '') +
    (r.pattern.endsWith('/query') ? '/query' : '');
  const url = `http://x.test${path}${init.qs ?? ''}`;
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: r.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const { response } = await dispatch(r, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

const notes = { collection: 'access-notes' };
const drafts = { collection: 'access-drafts' };
const gate = { collection: 'access-gate' };

function titlesOf(body: unknown): unknown[] {
  return (body as Record<string, unknown>[]).map((record) => record.title);
}

describe('row scoping', () => {
  it('lists only the rows inside the caller scope, on both list transports', async () => {
    const list = await call(ROUTES.list, notes, writer.token);
    strictEqual(list.status, 200);
    deepStrictEqual(titlesOf(list.body), ['Writer note']);

    const query = await call(ROUTES.query, notes, other.token, { body: {} });
    strictEqual(query.status, 200);
    deepStrictEqual(titlesOf(query.body), ['Other note']);
  });

  it('404s a cross-owner read, byte-identical to a missing record', async () => {
    strictEqual(
      (await call(ROUTES.read, { ...notes, uuid: writerNote }, writer.token)).status,
      200,
    );
    const cross = await call(ROUTES.read, { ...notes, uuid: otherNote }, writer.token);
    const missing = await call(ROUTES.read, { ...notes, uuid: 'missing' }, writer.token);
    strictEqual(cross.status, 404);
    deepStrictEqual(cross.body, missing.body);
  });

  it('patches only rows inside the scope', async () => {
    const cross = await call(ROUTES.patch, { ...notes, uuid: otherNote }, writer.token, {
      body: { title: 'Stolen' },
    });
    strictEqual(cross.status, 404);
    const untouched = await queryUntyped('AccessNotes').where({ UUID: otherNote }).findFirst();
    strictEqual(untouched?.title, 'Other note');

    const mine = await call(ROUTES.patch, { ...notes, uuid: writerNote }, writer.token, {
      body: { title: 'Writer note 2' },
    });
    strictEqual(mine.status, 200);
    strictEqual((mine.body as Record<string, unknown>).title, 'Writer note 2');
  });

  it('deletes only rows inside the scope', async () => {
    strictEqual((await call(ROUTES.del, { ...notes, uuid: writerNote }, other.token)).status, 404);
    strictEqual((await call(ROUTES.del, { ...notes, uuid: otherNote }, other.token)).status, 204);
  });

  it('leaves a create unfiltered by the scope where - only the verdict gates', async () => {
    const { status, body } = await call(ROUTES.create, notes, writer.token, {
      body: { title: 'New', owner: writer.uuid },
    });
    strictEqual(status, 201);
    strictEqual((body as Record<string, unknown>).owner, writer.uuid);
  });
});

describe('field scoping', () => {
  it('narrows list and record reads to the scope select', async () => {
    const list = await call(ROUTES.list, drafts, anonymous);
    strictEqual(list.status, 200);
    deepStrictEqual(list.body, [{ title: 'Draft' }]);

    const read = await call(ROUTES.read, { ...drafts, uuid: draft }, anonymous);
    deepStrictEqual(read.body, { title: 'Draft' });
  });

  it('never widens past the scope for a request naming only out-of-scope fields', async () => {
    const { body } = await call(ROUTES.read, { ...drafts, uuid: draft }, anonymous, {
      qs: '?select=note',
    });
    deepStrictEqual(body, { title: 'Draft' });
  });

  it('narrows a patch to the scope select: out-of-scope input drops, the response narrows', async () => {
    const { status, body } = await call(ROUTES.patch, { ...drafts, uuid: draft }, anonymous, {
      body: { title: 'Draft 2', note: 'rewritten' },
    });
    strictEqual(status, 200);
    deepStrictEqual(body, { title: 'Draft 2' });
    const row = await queryUntyped('AccessDrafts').where({ UUID: draft }).findFirst();
    strictEqual(row?.note, 'hidden');
  });
});

describe('verdicts', () => {
  it('answers false as the identical 404, never a 403', async () => {
    const denied = await call(ROUTES.list, gate, anonymous);
    const unknown = await call(ROUTES.list, { collection: 'no-such' }, anonymous);
    strictEqual(denied.status, 404);
    deepStrictEqual(denied.body, unknown.body);

    const capable = await call(ROUTES.patch, { ...gate, uuid: gateRow }, admin.token, {
      body: { title: 'X' },
    });
    strictEqual(capable.status, 404);
  });

  it('runs the operation unscoped under true', async () => {
    const { status, body } = await call(ROUTES.list, gate, writer.token);
    strictEqual(status, 200);
    deepStrictEqual(titlesOf(body), ['Open']);
  });

  it('never resolves access once a middleware answers', async () => {
    const { status } = await call(ROUTES.list, { collection: 'access-blocked' }, anonymous);
    strictEqual(status, 401);
    strictEqual(accessResolutions, 0);
  });

  it('500s an empty scope select instead of widening the read', async () => {
    const { status } = await call(ROUTES.list, { collection: 'access-empty' }, anonymous);
    strictEqual(status, 500);
  });
});
