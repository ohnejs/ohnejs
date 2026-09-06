import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../../src/layer/api/collections/[collection]/[uuid].delete.ts';
import uuidGet from '../../../../src/layer/api/collections/[collection]/[uuid].get.ts';
import uuidPatch from '../../../../src/layer/api/collections/[collection]/[uuid].patch.ts';
import listGet from '../../../../src/layer/api/collections/[collection]/index.get.ts';
import createPost from '../../../../src/layer/api/collections/[collection]/index.post.ts';
import queryPost from '../../../../src/layer/api/collections/[collection]/query.post.ts';
import { hashSessionToken } from '../../../../src/layer/auth/_token.ts';
import SessionsCollection from '../../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../../src/layer/collections/Users.ts';
import datePatternField from '../../../../src/layer/fields/date-pattern.ts';
import languageField from '../../../../src/layer/fields/language.ts';
import localeField from '../../../../src/layer/fields/locale.ts';
import passwordField from '../../../../src/layer/fields/password.ts';
import rolesField from '../../../../src/layer/fields/roles.ts';
import timezoneField from '../../../../src/layer/fields/timezone.ts';
import requireAuthMiddleware from '../../../../src/layer/middleware/require-auth.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/guard-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useMiddleware().register('require-auth', requireAuthMiddleware);

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('guard-reader', {
  name: 'guard-reader',
  role: { capabilities: ['collection.GuardPosts.read'] },
});
useRoles().register('guard-creator', {
  name: 'guard-creator',
  role: { capabilities: ['collection.GuardPosts.create'] },
});
useRoles().register('guard-owner', {
  name: 'guard-owner',
  role: { capabilities: ['collection.GuardPosts.*'] },
});

useCollections().register('GuardPosts', {
  name: 'GuardPosts',
  collection: { api: true, fields: { title: field('text') } },
});
useCollections().register('GuardMixed', {
  name: 'GuardMixed',
  collection: {
    api: {
      read: 'public',
      create: true,
      update: { public: true, middleware: ['require-auth'] },
      delete: { middleware: ['guard-note'] },
    },
    fields: { title: field('text') },
  },
});

useMiddleware().register('guard-note', () => undefined);

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<string> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

const anonymous = null;
const admin = await userWith('admin@example.com', ['admin']);
const reader = await userWith('reader@example.com', ['guard-reader']);
const creator = await userWith('creator@example.com', ['guard-creator']);
const owner = await userWith('owner@example.com', ['guard-owner']);
const both = await userWith('both@example.com', ['guard-reader', 'guard-creator']);
const nobody = await userWith('nobody@example.com', []);

useRoles().register('ghost', { name: 'ghost', role: { capabilities: ['*'] } });
const ghostly = await userWith('ghostly@example.com', ['ghost']);
useRoles().delete('ghost');

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
  applied: string[];
}

async function call(
  r: Route,
  params: Record<string, string>,
  bearer: string | null,
  body?: unknown,
): Promise<CallResult> {
  const path =
    `/collections/${params.collection}` +
    (params.uuid ? `/${params.uuid}` : '') +
    (r.pattern.endsWith('/query') ? '/query' : '');
  const url = `http://x.test${path}`;
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: r.method ?? 'GET',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { response, event } = await dispatch(r, request, new URL(url), params);
  return { status: response.status, applied: event.appliedMiddleware as string[] };
}

const posts = { collection: 'guard-posts' };
const mixed = { collection: 'guard-mixed' };

describe('guarded operations', () => {
  it('401s an anonymous request before any endpoint middleware runs', async () => {
    const { status, applied } = await call(ROUTES.del, { ...mixed, uuid: 'x' }, anonymous);
    strictEqual(status, 401);
    deepStrictEqual(applied, []);
  });

  it('403s a user without the capability, and one with no roles at all', async () => {
    strictEqual((await call(ROUTES.create, posts, reader, { title: 'X' })).status, 403);
    strictEqual((await call(ROUTES.list, posts, nobody)).status, 403);
  });

  it('admits the exact capability, mapping every read endpoint to `read`', async () => {
    strictEqual((await call(ROUTES.list, posts, reader)).status, 200);
    strictEqual((await call(ROUTES.query, posts, reader, {})).status, 200);
    strictEqual((await call(ROUTES.read, { ...posts, uuid: 'missing' }, reader)).status, 404);
    strictEqual((await call(ROUTES.create, posts, creator, { title: 'C' })).status, 201);
  });

  it('unions capabilities across roles', async () => {
    strictEqual((await call(ROUTES.list, posts, both)).status, 200);
    strictEqual((await call(ROUTES.create, posts, both, { title: 'B' })).status, 201);
    strictEqual((await call(ROUTES.del, { ...posts, uuid: 'x' }, both)).status, 403);
  });

  it('covers every operation through the per-collection wildcard', async () => {
    strictEqual((await call(ROUTES.list, posts, owner)).status, 200);
    strictEqual((await call(ROUTES.create, posts, owner, { title: 'O' })).status, 201);
    strictEqual((await call(ROUTES.del, { ...posts, uuid: 'missing' }, owner)).status, 404);
  });

  it('covers everything through `*`, the collections API included', async () => {
    strictEqual((await call(ROUTES.list, posts, admin)).status, 200);
    strictEqual((await call(ROUTES.list, { collection: 'users' }, admin)).status, 200);
    strictEqual((await call(ROUTES.create, posts, admin, { title: 'A' })).status, 201);
  });

  it('grants nothing through a role name no definition backs', async () => {
    strictEqual((await call(ROUTES.list, posts, ghostly)).status, 403);
  });
});

describe('public operations', () => {
  it('opens a `public` operation to anyone while siblings stay guarded', async () => {
    strictEqual((await call(ROUTES.list, mixed, anonymous)).status, 200);
    strictEqual((await call(ROUTES.create, mixed, anonymous, { title: 'X' })).status, 401);
    strictEqual((await call(ROUTES.create, mixed, nobody, { title: 'X' })).status, 403);
    strictEqual((await call(ROUTES.create, mixed, admin, { title: 'X' })).status, 201);
  });

  it('requires only a signed-in user under `public` + `require-auth`', async () => {
    strictEqual((await call(ROUTES.patch, { ...mixed, uuid: 'x' }, anonymous, {})).status, 401);
    const { status } = await call(ROUTES.patch, { ...mixed, uuid: 'missing' }, nobody, {
      title: 'Y',
    });
    strictEqual(status, 404);
  });
});
