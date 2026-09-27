import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import loginHandler from '../../../src/base/api/auth/login.post.ts';
import meGetHandler from '../../../src/base/api/auth/me.get.ts';
import mePatchHandler from '../../../src/base/api/auth/me.patch.ts';
import '../../../src/base/boot/sessions.ts';
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
import { collectionTableName } from '../../../src/ohne/database/naming/table-names.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { hashPassword } from '../../../src/utils/crypto/hash-password.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps hashing and the login timing-equalizer (`dummyVerify`) fast.
useLayers().add({
  path: '/base-sessions-boot-test',
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

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

function route(method: 'GET' | 'POST' | 'PATCH', pattern: string, handler: AnyHandler): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohnejs/base', handler };
}

const ROUTES = {
  login: route('POST', '/auth/login', loginHandler as AnyHandler),
  me: route('GET', '/auth/me', meGetHandler as AnyHandler),
  patch: route('PATCH', '/auth/me', mePatchHandler as AnyHandler),
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

async function account(email: string): Promise<void> {
  await queryUntyped('Users').createOrThrow({ email, password: 'correct horse' });
}

async function login(email: string, password = 'correct horse'): Promise<string> {
  const response = await call(ROUTES.login, undefined, { email, password });
  const header = response.headers.getSetCookie().find((c) => c.startsWith('session='));
  if (header === undefined) throw new Error('no session cookie was set');
  return header.split(';', 1)[0];
}

async function status(cookie: string): Promise<number> {
  return (await call(ROUTES.me, cookie)).status;
}

describe('the sessions boot file', () => {
  it('ends the other sessions when a user changes their password, keeping the current one', async () => {
    await account('self@example.com');
    await account('bystander@example.com');
    const phone = await login('self@example.com');
    const laptop = await login('self@example.com');
    const bystander = await login('bystander@example.com');

    strictEqual((await call(ROUTES.patch, phone, { password: 'new horse' })).status, 200);

    strictEqual(await status(phone), 200);
    strictEqual(await status(laptop), 401);
    strictEqual(await status(bystander), 200);
  });

  it('ends every session when the password changes outside a request', async () => {
    await account('reset@example.com');
    const phone = await login('reset@example.com');
    const laptop = await login('reset@example.com');

    await queryUntyped('Users')
      .where({ email: 'reset@example.com' })
      .updateOrThrow({ password: 'new horse' });

    strictEqual(await status(phone), 401);
    strictEqual(await status(laptop), 401);
    await login('reset@example.com', 'new horse');
  });

  it('keeps every session when an update leaves the password alone', async () => {
    await account('rename@example.com');
    const phone = await login('rename@example.com');
    const laptop = await login('rename@example.com');

    strictEqual((await call(ROUTES.patch, phone, { firstName: 'Anduin' })).status, 200);
    await queryUntyped('Users')
      .where({ email: 'rename@example.com' })
      .updateOrThrow({ lastName: 'W' });

    strictEqual(await status(phone), 200);
    strictEqual(await status(laptop), 200);
  });

  it('keeps every session when a sign-in rehashes the same password at a new cost', async () => {
    await account('rehash@example.com');
    const phone = await login('rehash@example.com');
    const stale = await hashPassword('correct horse', { cost: 2048 });
    await db.run(`UPDATE "${collectionTableName('Users')}" SET "password" = ? WHERE "email" = ?`, [
      stale,
      'rehash@example.com',
    ]);

    await login('rehash@example.com');

    strictEqual(await status(phone), 200);
  });
});
