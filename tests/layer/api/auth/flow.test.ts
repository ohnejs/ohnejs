import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/layer/api/auth/login.post.ts';
import logoutHandler from '../../../../src/layer/api/auth/logout.post.ts';
import meHandler from '../../../../src/layer/api/auth/me.get.ts';
import SessionsCollection from '../../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../../src/layer/collections/Users.ts';
import passwordField from '../../../../src/layer/fields/password.ts';
import rolesField from '../../../../src/layer/fields/roles.ts';
import requireAuthMiddleware from '../../../../src/layer/middleware/require-auth.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useEvent } from '../../../../src/ohne/http/use-event.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { defineHandler } from '../../../../src/ohne/routes/define-handler.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps hashing and the login timing-equalizer (`dummyVerify`) fast.
useLayers().add({ path: '/auth-flow-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
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
  return { method, pattern, file: `${pattern}.ts`, layer: 'ohne', handler };
}

useMiddleware().register('require-auth', requireAuthMiddleware);
const protectedRoute = route(
  'GET',
  '/protected',
  defineHandler(() => useEvent().context.user, { middleware: ['require-auth'] }) as AnyHandler,
);

const ROUTES = {
  login: route('POST', '/auth/login', loginHandler as AnyHandler),
  logout: route('POST', '/auth/logout', logoutHandler as AnyHandler),
  me: route('GET', '/auth/me', meHandler as AnyHandler),
};

interface CallOptions {
  json?: unknown;
  cookie?: string;
  bearer?: string;
}

async function call(r: Route, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  const sendBody = 'json' in options;
  if (sendBody) headers.set('Content-Type', 'application/json');
  if (options.cookie !== undefined) headers.set('Cookie', options.cookie);
  if (options.bearer !== undefined) headers.set('Authorization', `Bearer ${options.bearer}`);
  const request = new Request(`http://localhost${r.pattern}`, {
    method: r.method ?? 'GET',
    headers,
    body: sendBody ? JSON.stringify(options.json) : undefined,
  });
  const { response } = await dispatch(r, request, new URL(request.url), {});
  return response;
}

function cookiePair(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith('session='));
  if (header === undefined) throw new Error('no session cookie was set');
  return header.split(';', 1)[0];
}

// The framework leaves account creation to the app, so the tests insert users directly.
async function createUser(email: string, password: string): Promise<void> {
  await queryUntyped('Users').createOrThrow({ email, password });
}

async function login(email: string, password: string): Promise<Response> {
  return call(ROUTES.login, { json: { email, password } });
}

describe('auth flow', () => {
  it('logs in, matching the email case-insensitively, and sets the safe session cookie', async () => {
    await createUser('Ada@Example.com', 'correct horse');
    const response = await login('ADA@example.com', 'correct horse');
    strictEqual(response.status, 200);
    const user = (await response.json()) as { UUID: string; email: string; roles: string[] };
    strictEqual(user.email, 'ada@example.com');
    match(user.UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
    deepStrictEqual(user.roles, []);

    const setCookie = response.headers.getSetCookie()[0];
    match(setCookie, /HttpOnly/);
    match(setCookie, /Secure/);
    match(setCookie, /SameSite=Lax/);
  });

  it('logs in only with the right password, and hides whether an email exists', async () => {
    await createUser('grace@example.com', 'battery staple');
    strictEqual((await login('grace@example.com', 'nope')).status, 401);
    strictEqual((await login('ghost@example.com', 'nope')).status, 401);
    const good = await login('grace@example.com', 'battery staple');
    strictEqual(good.status, 200);
    strictEqual(((await good.json()) as { email: string }).email, 'grace@example.com');
  });

  it('answers a clean 4xx, not 500, for a JSON null body', async () => {
    strictEqual((await call(ROUTES.login, { json: null })).status, 400);
  });

  it('resolves the current user from a cookie and a bearer token, and 401 without one', async () => {
    await createUser('mesh@example.com', 'correct horse');
    const session = await login('mesh@example.com', 'correct horse');
    const pair = cookiePair(session);
    const token = pair.slice('session='.length);

    strictEqual((await call(ROUTES.me, { cookie: pair })).status, 200);
    strictEqual((await call(ROUTES.me, { bearer: token })).status, 200);
    strictEqual((await call(ROUTES.me)).status, 401);
  });

  it('logs out, revoking the session server-side', async () => {
    await createUser('out@example.com', 'correct horse');
    const pair = cookiePair(await login('out@example.com', 'correct horse'));

    const logout = await call(ROUTES.logout, { cookie: pair });
    strictEqual(logout.status, 200);
    strictEqual(((await logout.json()) as { ok: boolean }).ok, true);

    strictEqual((await call(ROUTES.me, { cookie: pair })).status, 401);
  });

  it('stores passwords and session tokens hashed, never in the clear', async () => {
    await createUser('safe@example.com', 'battery staple');
    const stored = (await queryUntyped('Users')
      .select('password')
      .where({ email: 'safe@example.com' })
      .findFirst()) as { password: string };
    match(stored.password, /^scrypt\$/);
    ok(!stored.password.includes('battery staple'));

    const token = cookiePair(await login('safe@example.com', 'battery staple')).slice(
      'session='.length,
    );
    const sessions = (await queryUntyped('Sessions').findMany()) as { tokenHash: string }[];
    ok(sessions.length > 0);
    ok(sessions.every((s) => s.tokenHash.length === 43 && s.tokenHash !== token));
  });

  it('gates a route through require-auth and fills event.context.user', async () => {
    await createUser('gate@example.com', 'correct horse');
    strictEqual((await call(protectedRoute)).status, 401);

    const pair = cookiePair(await login('gate@example.com', 'correct horse'));
    const response = await call(protectedRoute, { cookie: pair });
    strictEqual(response.status, 200);
    strictEqual(((await response.json()) as { email: string }).email, 'gate@example.com');
  });
});
