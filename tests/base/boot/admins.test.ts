import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { hook } from 'ohnejs';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import installPost from '../../../src/base/api/auth/install.post.ts';
import uuidDelete from '../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import uuidPatch from '../../../src/base/api/collections/[collection]/[uuid].patch.ts';
import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import '../../../src/base/boot/admins.ts';
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
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { connectTest, dialect } from '../../_dialect.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/base-admins-boot-test', input: { auth: { password: { cost: 1024 } } } });

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
useRoles().register('manager', { name: 'manager', role: { capabilities: ['collection.Users.*'] } });

const db = await connectTest();
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

const ROUTES = {
  install: route('POST', '/auth/install', installPost),
  patch: route('PATCH', '/collections/[collection]/[uuid]', uuidPatch),
  del: route('DELETE', '/collections/[collection]/[uuid]', uuidDelete),
};

async function call(
  r: Route,
  bearer: string | null,
  init: { uuid?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
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
  body: { email: 'root@example.com', password: 'root-secret-1' },
});
const rootUUID = (installed.body as { UUID: string }).UUID;
const root = { uuid: rootUUID, token: await signIn(rootUUID) };
const manager = await userWith('manager@example.com', ['manager']);

let nestOn = false;
hook('record:before-update', async ({ collection, matched, tx }) => {
  if (!nestOn || collection !== 'Users' || matched.includes(manager.uuid)) return;
  await queryUntyped('Users').use(tx).where({ UUID: manager.uuid }).update({ firstName: 'Nested' });
});

describe('the last admin', () => {
  it('refuses the only admin dropping their `admin` role at `roles`', async () => {
    const { status, body } = await call(ROUTES.patch, root.token, {
      uuid: root.uuid,
      body: { roles: ['manager'] },
    });
    strictEqual(status, 422);
    deepStrictEqual((body as { data: { errors: object } }).data.errors, {
      roles: 'auth.lastAdmin',
    });
    deepStrictEqual(await rolesOf(root.uuid), ['admin']);
  });

  it('refuses the only admin deleting themselves with a `409`', async () => {
    const { status } = await call(ROUTES.del, root.token, { uuid: root.uuid });
    strictEqual(status, 409);
    ok(await queryUntyped('Users').where({ UUID: root.uuid }).exists());
  });

  it('lets the only admin change everything but their `admin` role', async () => {
    const { status } = await call(ROUTES.patch, root.token, {
      uuid: root.uuid,
      body: { firstName: 'Root', roles: ['admin', 'manager'] },
    });
    strictEqual(status, 200);
  });

  it('refuses a query that demotes every admin, writing nothing', async () => {
    const everyone = { UUID: { in: [root.uuid, manager.uuid] } };
    deepStrictEqual(await queryUntyped('Users').where(everyone).update({ roles: [] }), {
      ok: false,
      errors: { roles: 'auth.lastAdmin' },
    });
    deepStrictEqual(await rolesOf(root.uuid), ['admin', 'manager']);
    deepStrictEqual(await rolesOf(manager.uuid), ['manager']);
  });

  it('refuses a query that deletes every user, deleting nothing', async () => {
    const everyone = { UUID: { in: [root.uuid, manager.uuid] } };
    await rejects(queryUntyped('Users').where(everyone).delete(), { status: 409 });
    strictEqual(await queryUntyped('Users').count(), 2);
  });

  it('keeps install disarmed once a manager deleted every user it reaches', async () => {
    const demoted = await call(ROUTES.patch, root.token, {
      uuid: root.uuid,
      body: { roles: ['manager'] },
    });
    strictEqual(demoted.status, 422);
    strictEqual((await call(ROUTES.del, manager.token, { uuid: root.uuid })).status, 404);
    strictEqual((await call(ROUTES.del, manager.token, { uuid: manager.uuid })).status, 204);
    const { status } = await call(ROUTES.install, null, {
      body: { email: 'attacker@example.com', password: 'attacker-pw-1' },
    });
    strictEqual(status, 403);
  });

  it('refuses a demotion even when a nested write on its `tx` touches another user', async () => {
    nestOn = true;
    await rejects(
      queryUntyped('Users')
        .where({ UUID: root.uuid })
        .updateOrThrow({ roles: ['manager'] }),
      { errors: { roles: 'auth.lastAdmin' } },
    );
    nestOn = false;
    deepStrictEqual(await rolesOf(root.uuid), ['admin', 'manager']);
  });

  it('lets an admin delete another admin while one remains', async () => {
    const third = await userWith('third@example.com', ['admin']);
    strictEqual((await call(ROUTES.del, root.token, { uuid: third.uuid })).status, 204);
  });

  it('lets an admin demote and delete another while one remains', async () => {
    const second = await userWith('second@example.com', ['admin']);
    const demoted = await call(ROUTES.patch, second.token, {
      uuid: root.uuid,
      body: { roles: ['manager'] },
    });
    strictEqual(demoted.status, 200);
    strictEqual((await call(ROUTES.del, second.token, { uuid: root.uuid })).status, 204);
  });

  it('leaves an instance that already has no admin unguarded', async () => {
    await db.run(`UPDATE "${collectionTableName('Users')}" SET "roles" = ?`, ['["manager"]']);
    const last = await queryUntyped('Users').findFirst();
    ok(last);
    await queryUntyped('Users').where({ UUID: last.UUID }).update({ password: 'new-pass-123' });
    deepStrictEqual(await queryUntyped('Users').where({ UUID: last.UUID }).delete(), {
      deleted: 1,
    });
  });
});
