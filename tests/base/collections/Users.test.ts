import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import installPost from '../../../src/base/api/auth/install.post.ts';
import loginPost from '../../../src/base/api/auth/login.post.ts';
import uuidDelete from '../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import uuidPatch from '../../../src/base/api/collections/[collection]/[uuid].patch.ts';
import createPost from '../../../src/base/api/collections/[collection]/index.post.ts';
import verdictsPost from '../../../src/base/api/collections/[collection]/verdicts.post.ts';
import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import { queryScoped } from '../../../src/base/auth/query-scoped.ts';
import SessionsCollection from '../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import adminRole from '../../../src/base/roles/admin.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/users-test', input: { auth: { password: { cost: 1024 } } } });

useMessages().register('en', {});
useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useRoles().register('admin', { name: 'admin', role: adminRole });
useRoles().register('manager', {
  name: 'manager',
  role: { capabilities: ['collection.Users.*', 'collection.Posts.*'] },
});
useRoles().register('editor', { name: 'editor', role: { capabilities: ['collection.Posts.*'] } });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const scopedUpdate: AnyHandler = async () => {
  await queryScoped('Users', 'update', { roles: ['admin'] });
  return null;
};

const ROUTES = {
  install: route('POST', '/auth/install', installPost),
  login: route('POST', '/auth/login', loginPost),
  create: route('POST', '/collections/[collection]', createPost),
  patch: route('PATCH', '/collections/[collection]/[uuid]', uuidPatch),
  del: route('DELETE', '/collections/[collection]/[uuid]', uuidDelete),
  verdicts: route('POST', '/collections/[collection]/verdicts', verdictsPost),
  scoped: route('POST', '/scoped', scopedUpdate),
};

interface CallResult {
  status: number;
  body: unknown;
}

async function call(
  r: Route,
  bearer: string | null,
  init: { uuid?: string; body?: unknown } = {},
): Promise<CallResult> {
  const params: Record<string, string> = { collection: 'users' };
  if (init.uuid !== undefined) params.uuid = init.uuid;
  const url = `http://x.test${r.pattern.replace('[collection]', 'users').replace('[uuid]', init.uuid ?? '')}`;
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

function errorsOf(body: unknown): Record<string, string> {
  return (body as { data: { errors: Record<string, string> } }).data.errors;
}

async function signIn(uuid: string): Promise<string> {
  const token = `token-${uuid}`;
  await queryUntyped('Sessions').createOrThrow({
    user: uuid,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

async function userWith(email: string, roles: string[]): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const uuid = record.UUID as string;
  return { uuid, token: await signIn(uuid) };
}

async function rolesOf(uuid: string): Promise<unknown> {
  return (await queryUntyped('Users').where({ UUID: uuid }).findFirst())?.roles;
}

const installed = await call(ROUTES.install, null, {
  body: { email: 'admin@example.com', password: 'admin-secret-1' },
});
const adminUUID = (installed.body as { UUID: string }).UUID;
const admin = { uuid: adminUUID, token: await signIn(adminUUID) };
const manager = await userWith('manager@example.com', ['manager']);
const peer = await userWith('peer@example.com', ['manager']);

describe('Users grant rule', () => {
  it('lets install create the first admin', () => {
    strictEqual(installed.status, 200);
    deepStrictEqual((installed.body as { roles: string[] }).roles, ['admin']);
  });

  it('refuses a manager granting itself `admin` at the offending entry', async () => {
    const { status, body } = await call(ROUTES.patch, manager.token, {
      uuid: manager.uuid,
      body: { roles: ['manager', 'admin'] },
    });
    strictEqual(status, 422);
    deepStrictEqual(Object.keys(errorsOf(body)), ['roles[1]']);
    deepStrictEqual(await rolesOf(manager.uuid), ['manager']);
  });

  it('hides an admin from a manager write as the identical 404', async () => {
    const password = await call(ROUTES.patch, manager.token, {
      uuid: admin.uuid,
      body: { password: 'attacker-pw-1' },
    });
    strictEqual(password.status, 404);
    const email = await call(ROUTES.patch, manager.token, {
      uuid: admin.uuid,
      body: { email: 'evil@example.com' },
    });
    strictEqual(email.status, 404);
    const login = await call(ROUTES.login, null, {
      body: { email: 'admin@example.com', password: 'admin-secret-1' },
    });
    strictEqual(login.status, 200);
  });

  it('refuses a manager creating an admin', async () => {
    const { status, body } = await call(ROUTES.create, manager.token, {
      body: { email: 'evil@example.com', password: 'evil-pass-123', roles: ['admin'] },
    });
    strictEqual(status, 422);
    deepStrictEqual(Object.keys(errorsOf(body)), ['roles[0]']);
    strictEqual(await queryUntyped('Users').where({ email: 'evil@example.com' }).exists(), false);
  });

  it('keeps an admin a manager tries to delete', async () => {
    const { status } = await call(ROUTES.del, manager.token, { uuid: admin.uuid });
    strictEqual(status, 404);
    ok(await queryUntyped('Users').where({ UUID: admin.uuid }).exists());
  });

  it('lets a manager create a user with a role it covers', async () => {
    const { status } = await call(ROUTES.create, manager.token, {
      body: { email: 'editor@example.com', password: 'editor-pass-1', roles: ['editor'] },
    });
    strictEqual(status, 201);
  });

  it('lets a manager edit itself and a peer', async () => {
    const own = await call(ROUTES.patch, manager.token, {
      uuid: manager.uuid,
      body: { firstName: 'Jaina', password: 'new-pass-123' },
    });
    strictEqual(own.status, 200);
    const other = await call(ROUTES.patch, manager.token, {
      uuid: peer.uuid,
      body: { lastName: 'Proudmoore' },
    });
    strictEqual(other.status, 200);
  });

  it('leaves a `*` admin unrestricted', async () => {
    const created = await call(ROUTES.create, admin.token, {
      body: { email: 'second@example.com', password: 'second-pass-1', roles: ['admin'] },
    });
    strictEqual(created.status, 201);
    const second = (created.body as { UUID: string }).UUID;
    const promoted = await call(ROUTES.patch, admin.token, {
      uuid: peer.uuid,
      body: { roles: ['manager', 'admin'] },
    });
    strictEqual(promoted.status, 200);
    const removed = await call(ROUTES.del, admin.token, { uuid: second });
    strictEqual(removed.status, 204);
  });

  it('applies the rule to `queryScoped`', async () => {
    const { status, body } = await call(ROUTES.scoped, manager.token);
    strictEqual(status, 422);
    deepStrictEqual(Object.keys(errorsOf(body)), ['roles[0]']);
  });

  it('answers verdicts that leave an admin out of a manager reach', async () => {
    const { status, body } = await call(ROUTES.verdicts, manager.token, {
      body: { UUIDs: [admin.uuid, manager.uuid] },
    });
    strictEqual(status, 200);
    const verdicts = body as { update: { UUIDs: string[] }; delete: { UUIDs: string[] } };
    deepStrictEqual(verdicts.update.UUIDs, [manager.uuid]);
    deepStrictEqual(verdicts.delete.UUIDs, [manager.uuid]);
  });
});
