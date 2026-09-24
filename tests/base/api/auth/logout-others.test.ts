import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
import othersHandler from '../../../../src/base/api/auth/logout/others.post.ts';
import meHandler from '../../../../src/base/api/auth/me.get.ts';
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
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps hashing and the login timing-equalizer (`dummyVerify`) fast.
useLayers().add({
  path: '/auth-logout-others-test',
  input: { auth: { password: { cost: 1024 } } },
});

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

function route(method: 'GET' | 'POST', pattern: string, handler: AnyHandler): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohnejs/base', handler };
}

const ROUTES = {
  login: route('POST', '/auth/login', loginHandler as AnyHandler),
  me: route('GET', '/auth/me', meHandler as AnyHandler),
  others: route('POST', '/auth/logout/others', othersHandler as AnyHandler),
};

async function call(r: Route, cookie?: string, json?: unknown): Promise<Response> {
  const headers = new Headers();
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie !== undefined) headers.set('Cookie', cookie);
  const request = new Request(`http://localhost${r.pattern}`, {
    method: r.method ?? 'GET',
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const { response } = await dispatch(r, request, new URL(request.url), {});
  return response;
}

async function login(email: string): Promise<string> {
  const response = await call(ROUTES.login, undefined, { email, password: 'correct horse' });
  const header = response.headers.getSetCookie().find((c) => c.startsWith('session='));
  if (header === undefined) throw new Error('no session cookie was set');
  return header.split(';', 1)[0];
}

async function status(r: Route, cookie?: string): Promise<number> {
  return (await call(r, cookie)).status;
}

describe('POST /auth/logout/others', () => {
  it('ends the other sessions of the user, keeping the current one and everyone else', async () => {
    await queryUntyped('Users').createOrThrow({
      email: 'multi@example.com',
      password: 'correct horse',
    });
    await queryUntyped('Users').createOrThrow({
      email: 'other@example.com',
      password: 'correct horse',
    });
    const phone = await login('multi@example.com');
    const laptop = await login('multi@example.com');
    const bystander = await login('other@example.com');

    const response = await call(ROUTES.others, phone);
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { ok: true });

    strictEqual(await status(ROUTES.me, phone), 200);
    strictEqual(await status(ROUTES.me, laptop), 401);
    strictEqual(await status(ROUTES.me, bystander), 200);
  });

  it('answers 401 without a session', async () => {
    strictEqual(await status(ROUTES.others), 401);
  });

  it('ends the other sessions past an app scope on Sessions', async () => {
    await queryUntyped('Users').createOrThrow({
      email: 'scoped@example.com',
      password: 'correct horse',
    });
    const phone = await login('scoped@example.com');
    const laptop = await login('scoped@example.com');
    hook('record:condition', (condition, { collection }) =>
      collection === 'Sessions'
        ? { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: 'none', negated: false }
        : condition,
    );
    try {
      strictEqual((await call(ROUTES.others, phone)).status, 200);
      strictEqual(await status(ROUTES.me, phone), 200);
      strictEqual(await status(ROUTES.me, laptop), 401);
    } finally {
      useHooks().clear();
    }
  });
});
