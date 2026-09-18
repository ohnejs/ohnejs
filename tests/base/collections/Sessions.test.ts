import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import uuidGet from '../../../src/base/api/collections/[collection]/[uuid].get.ts';
import listGet from '../../../src/base/api/collections/[collection]/index.get.ts';
import createPost from '../../../src/base/api/collections/[collection]/index.post.ts';
import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import SessionsCollection from '../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/sessions-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

interface Login {
  uuid: string;
  token: string;
  session: string;
}

async function userWith(email: string): Promise<Login> {
  const user = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456' });
  const token = `token-${email}`;
  const session = await queryUntyped('Sessions').createOrThrow({
    user: user.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return { uuid: user.UUID as string, token, session: session.UUID as string };
}

const anonymous = null;
const writer = await userWith('writer@example.com');
const other = await userWith('other@example.com');

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
  create: route('POST', '/collections/[collection]', createPost),
  read: route('GET', '/collections/[collection]/[uuid]', uuidGet),
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
  const path = `/collections/${params.collection}` + (params.uuid ? `/${params.uuid}` : '');
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

const sessions = { collection: 'sessions' };

describe('sessions API', () => {
  it('404s an anonymous read, byte-identical to an unknown collection', async () => {
    const denied = await call(ROUTES.list, sessions, anonymous);
    const unknown = await call(ROUTES.list, { collection: 'no-such' }, anonymous);
    strictEqual(denied.status, 404);
    deepStrictEqual(denied.body, unknown.body);
  });

  it('lists only the caller sessions, without the token hash', async () => {
    const { status, body } = await call(ROUTES.list, sessions, writer.token);
    strictEqual(status, 200);
    const rows = body as Record<string, unknown>[];
    strictEqual(rows.length, 1);
    strictEqual(rows[0].UUID, writer.session);
    strictEqual(rows[0].user, writer.uuid);
    ok(!('tokenHash' in rows[0]));
  });

  it('rejects a select naming the hidden hash', async () => {
    const { status } = await call(ROUTES.list, sessions, writer.token, { qs: '?select=tokenHash' });
    strictEqual(status, 400);
  });

  it('reads only own sessions by UUID', async () => {
    const own = await call(ROUTES.read, { ...sessions, uuid: writer.session }, writer.token);
    strictEqual(own.status, 200);
    const cross = await call(ROUTES.read, { ...sessions, uuid: other.session }, writer.token);
    strictEqual(cross.status, 404);
  });

  it('keeps the write operations closed', async () => {
    const created = await call(ROUTES.create, sessions, writer.token, {
      body: { user: writer.uuid, tokenHash: 'x', expiresAt: 1 },
    });
    strictEqual(created.status, 404);
  });

  it('revokes only own sessions; a revoked bearer turns anonymous', async () => {
    const cross = await call(ROUTES.del, { ...sessions, uuid: other.session }, writer.token);
    strictEqual(cross.status, 404);
    const untouched = await queryUntyped('Sessions').where({ UUID: other.session }).findFirst();
    ok(untouched !== undefined);

    const own = await call(ROUTES.del, { ...sessions, uuid: writer.session }, writer.token);
    strictEqual(own.status, 204);
    const revoked = await call(ROUTES.list, sessions, writer.token);
    strictEqual(revoked.status, 404);
  });
});
