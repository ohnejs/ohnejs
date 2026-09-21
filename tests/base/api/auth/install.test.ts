import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../../src/base/auth/types.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import installGetHandler from '../../../../src/base/api/auth/install.get.ts';
import installPostHandler from '../../../../src/base/api/auth/install.post.ts';
import SessionsCollection from '../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../src/base/fields/language.ts';
import localeField from '../../../../src/base/fields/locale.ts';
import passwordField from '../../../../src/base/fields/password.ts';
import rolesField from '../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({
  path: '/auth-install-test',
  input: { auth: { password: { cost: 1024 } } },
});

useMessages().register('en', {});
useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

function route(method: 'GET' | 'POST', pattern: string, handler: AnyHandler): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohnejs/base', handler };
}

const ROUTES = {
  get: route('GET', '/auth/install', installGetHandler as AnyHandler),
  post: route('POST', '/auth/install', installPostHandler as AnyHandler),
};

async function call(r: Route, json?: unknown): Promise<Response> {
  const headers = new Headers();
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(`http://localhost${r.pattern}`, {
    method: r.method ?? 'GET',
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const { response } = await dispatch(r, request, new URL(request.url), {});
  return response;
}

async function required(): Promise<boolean> {
  return ((await (await call(ROUTES.get)).json()) as { required: boolean }).required;
}

async function reset(): Promise<void> {
  await queryUntyped('Sessions')
    .where({ expiresAt: { greaterThan: 0 } })
    .delete();
  await queryUntyped('Users')
    .where({ roles: { includes: 'admin' } })
    .delete();
}

describe('POST /auth/install', () => {
  it('creates the first admin with the name and signs it in', async () => {
    strictEqual(await required(), true);
    const response = await call(ROUTES.post, {
      firstName: 'Anduin',
      lastName: 'Wrynn',
      email: 'anduin@example.com',
      password: 'correct horse',
    });
    strictEqual(response.status, 200);
    const user = (await response.json()) as User;
    strictEqual(user.firstName, 'Anduin');
    strictEqual(user.lastName, 'Wrynn');
    strictEqual(user.email, 'anduin@example.com');
    deepStrictEqual(user.roles, ['admin']);
    ok(response.headers.getSetCookie().some((c) => c.startsWith('session=')));
    strictEqual(await required(), false);
    await reset();
  });

  it('stores an omitted or empty name as null', async () => {
    const response = await call(ROUTES.post, {
      firstName: null,
      email: 'garrosh@example.com',
      password: 'correct horse',
    });
    strictEqual(response.status, 200);
    const user = (await response.json()) as User;
    strictEqual(user.firstName, null);
    strictEqual(user.lastName, null);
    await reset();
  });

  it('answers the field errors of a bad setup as 422', async () => {
    const response = await call(ROUTES.post, { email: 'not-an-email' });
    strictEqual(response.status, 422);
    const body = (await response.json()) as { data: { errors: Record<string, string> } };
    ok('email' in body.data.errors);
    ok('password' in body.data.errors);
    strictEqual(await required(), true);
  });

  it('refuses with 403 once a user exists', async () => {
    strictEqual(
      (await call(ROUTES.post, { email: 'first@example.com', password: 'correct horse' })).status,
      200,
    );
    const response = await call(ROUTES.post, {
      email: 'second@example.com',
      password: 'correct horse',
    });
    strictEqual(response.status, 403);
    strictEqual(await required(), false);
    await reset();
  });
});
