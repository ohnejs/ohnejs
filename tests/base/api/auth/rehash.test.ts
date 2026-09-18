import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
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
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({ path: '/auth-rehash-test', input: { auth: { password: { cost: 1024 } } } });

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

const login: Route = {
  method: 'POST',
  pattern: '/auth/login',
  file: '/auth/login.ts',
  layer: 'ohnejs/base',
  handler: loginHandler as AnyHandler,
};

async function attempt(email: string, password: string): Promise<Response> {
  const request = new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { response } = await dispatch(login, request, new URL(request.url), {});
  return response;
}

async function storedHash(email: string): Promise<string> {
  const row = await db.queryOne<{ password: string }>(
    'SELECT "password" FROM "Users" WHERE "email" = ?',
    [email],
  );
  ok(row);
  return row.password;
}

describe('login rehashes a stale-cost password', () => {
  it('rewrites the stored hash at the raised cost on a successful sign-in', async () => {
    await queryUntyped('Users').createOrThrow({ email: 'ada@example.com', password: 'hunter2' });
    ok((await storedHash('ada@example.com')).startsWith('scrypt$1024$'));

    useLayers().add({ path: '/auth-rehash-raise', input: { auth: { password: { cost: 2048 } } } });

    const wrong = await attempt('ada@example.com', 'nope');
    strictEqual(wrong.status, 401);
    ok((await storedHash('ada@example.com')).startsWith('scrypt$1024$'));

    const raised = await attempt('ada@example.com', 'hunter2');
    strictEqual(raised.status, 200);
    ok((await storedHash('ada@example.com')).startsWith('scrypt$2048$'));

    const settled = await attempt('ada@example.com', 'hunter2');
    strictEqual(settled.status, 200);
    ok((await storedHash('ada@example.com')).startsWith('scrypt$2048$'));
  });
});
