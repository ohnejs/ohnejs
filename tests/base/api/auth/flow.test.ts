import { deepStrictEqual, doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../../src/base/auth/types.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
import logoutHandler from '../../../../src/base/api/auth/logout.post.ts';
import meHandler from '../../../../src/base/api/auth/me.get.ts';
import SessionsCollection from '../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../src/base/fields/language.ts';
import localeField from '../../../../src/base/fields/locale.ts';
import passwordField from '../../../../src/base/fields/password.ts';
import rolesField from '../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../src/base/fields/timezone.ts';
import corsGlobal from '../../../../src/base/middleware/global/cors.ts';
import requireAuthMiddleware from '../../../../src/base/middleware/require-auth.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useEvent } from '../../../../src/ohne/http/use-event.ts';
import { DEFAULTS } from '../../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { defineHandler } from '../../../../src/ohne/routes/define-handler.ts';
import { parseDuration } from '../../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps hashing and the login timing-equalizer (`dummyVerify`) fast.
useLayers().add({
  path: '/auth-flow-test',
  defaults: DEFAULTS,
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

useMiddleware().register('require-auth', requireAuthMiddleware);
useMiddleware().registerGlobal('cors', corsGlobal);
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
  sameSite?: string;
}

async function call(r: Route, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  const sendBody = 'json' in options;
  if (sendBody) headers.set('Content-Type', 'application/json');
  if (options.cookie !== undefined) headers.set('Cookie', options.cookie);
  if (options.bearer !== undefined) headers.set('Authorization', `Bearer ${options.bearer}`);
  if (options.sameSite !== undefined) {
    headers.set('Origin', options.sameSite);
    headers.set('Sec-Fetch-Site', 'same-site');
  }
  const request = new Request(`http://localhost${r.pattern}`, {
    method: r.method ?? 'GET',
    headers,
    body: sendBody ? JSON.stringify(options.json) : undefined,
  });
  const { response } = await dispatch(r, request, new URL(request.url), {});
  return response;
}

function sessionCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith('session='));
  if (header === undefined) throw new Error('no session cookie was set');
  return header;
}

function cookiePair(response: Response): string {
  return sessionCookie(response).split(';', 1)[0];
}

async function createUser(email: string, password: string): Promise<void> {
  await queryUntyped('Users').createOrThrow({ email, password });
}

async function login(email: string, password: string, remember?: boolean): Promise<Response> {
  return call(ROUTES.login, { json: { email, password, remember } });
}

function defaults(UUID: string, email: string): User {
  return {
    UUID,
    email,
    firstName: null,
    lastName: null,
    roles: [],
    dashboardLanguage: null,
    contentLanguage: null,
    timezone: null,
    dateFormat: 'LL',
    timeFormat: 'LTS',
    smartClipboard: false,
  };
}

async function assertSessionLifetime(userUUID: string, lifetime: string): Promise<void> {
  const row = await db.queryOne<{ expiresAt: number }>(
    'SELECT "expiresAt" FROM "Sessions" WHERE "user" = ?',
    [userUUID],
  );
  ok(row);
  const drift = Math.abs(row.expiresAt - Date.now() - parseDuration(lifetime));
  ok(drift < parseDuration('1m'), `session expires ${drift}ms away from ${lifetime}`);
}

describe('auth flow', () => {
  it('logs in, matching the email case-insensitively, and sets the safe session cookie', async () => {
    await createUser('Anduin@Example.com', 'correct horse');
    const response = await login('ANDUIN@example.com', 'correct horse');
    strictEqual(response.status, 200);
    const user = (await response.json()) as User;
    match(user.UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
    deepStrictEqual(user, defaults(user.UUID, 'anduin@example.com'));

    const setCookie = response.headers.getSetCookie()[0];
    match(setCookie, /HttpOnly/);
    match(setCookie, /Secure/);
    match(setCookie, /SameSite=Lax/);
  });

  it('sizes the cookie and the stored row to whether the login asked to be remembered', async () => {
    await createUser('kept@example.com', 'correct horse');
    await createUser('brief@example.com', 'correct horse');

    const kept = await login('kept@example.com', 'correct horse', true);
    match(sessionCookie(kept), /Max-Age=\d+/);
    await assertSessionLifetime(((await kept.json()) as { UUID: string }).UUID, '30d');

    const brief = await login('brief@example.com', 'correct horse', false);
    doesNotMatch(sessionCookie(brief), /Max-Age/);
    await assertSessionLifetime(((await brief.json()) as { UUID: string }).UUID, '1d');
  });

  it('logs in only with the right password, and hides whether an email exists', async () => {
    await createUser('garrosh@example.com', 'battery staple');
    strictEqual((await login('garrosh@example.com', 'nope')).status, 401);
    strictEqual((await login('ghost@example.com', 'nope')).status, 401);
    const good = await login('garrosh@example.com', 'battery staple');
    strictEqual(good.status, 200);
    strictEqual(((await good.json()) as { email: string }).email, 'garrosh@example.com');
  });

  it('answers a clean 4xx, not 500, for a JSON null body', async () => {
    strictEqual((await call(ROUTES.login, { json: null })).status, 400);
  });

  it('resolves the current user from a cookie and a bearer token, and 401 without one', async () => {
    await createUser('mesh@example.com', 'correct horse');
    const session = await login('mesh@example.com', 'correct horse');
    const pair = cookiePair(session);
    const token = pair.slice('session='.length);
    const { UUID } = (await session.json()) as User;

    const me = await call(ROUTES.me, { cookie: pair });
    strictEqual(me.status, 200);
    deepStrictEqual(await me.json(), defaults(UUID, 'mesh@example.com'));
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

  it('refuses a logout forged from a same-site page, and logs out from the dashboard', async () => {
    await createUser('forged@example.com', 'correct horse');
    const pair = cookiePair(await login('forged@example.com', 'correct horse'));

    const forged = await call(ROUTES.logout, { cookie: pair, sameSite: 'http://localhost:3000' });
    strictEqual(forged.status, 403);
    deepStrictEqual(forged.headers.getSetCookie(), []);
    strictEqual((await call(ROUTES.me, { cookie: pair })).status, 200);

    const logout = await call(ROUTES.logout, { cookie: pair, sameSite: 'http://localhost:9000' });
    strictEqual(logout.status, 200);
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
    const sessions = (await queryUntyped('Sessions').select('tokenHash').findMany()) as {
      tokenHash: string;
    }[];
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

describe('createSession sweeps expired rows', () => {
  async function userUUID(email: string): Promise<string> {
    const row = await db.queryOne<{ UUID: string }>(
      'SELECT "UUID" FROM "Users" WHERE "email" = ?',
      [email],
    );
    ok(row);
    return row.UUID;
  }

  it('purges expired sessions on the next login, keeping live ones', async () => {
    await createUser('sweeper@example.com', 'correct horse');
    await createUser('bystander@example.com', 'correct horse');
    strictEqual((await login('sweeper@example.com', 'correct horse')).status, 200);
    strictEqual((await login('bystander@example.com', 'correct horse')).status, 200);

    const sweeper = await userUUID('sweeper@example.com');
    await db.run('UPDATE "Sessions" SET "expiresAt" = ? WHERE "user" = ?', [1, sweeper]);

    strictEqual((await login('sweeper@example.com', 'correct horse')).status, 200);

    const rows = await db.query<{ user: string; expiresAt: number }>(
      'SELECT "user", "expiresAt" FROM "Sessions"',
    );
    strictEqual(rows.filter((row) => row.expiresAt <= Date.now()).length, 0);
    strictEqual(rows.filter((row) => row.user === sweeper).length, 1);
    strictEqual(
      rows.filter((row) => row.user !== sweeper && row.expiresAt > Date.now()).length >= 1,
      true,
    );
  });
});
