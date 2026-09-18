import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../../src/base/auth/types.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
import meGetHandler from '../../../../src/base/api/auth/me.get.ts';
import mePatchHandler from '../../../../src/base/api/auth/me.patch.ts';
import { DEFAULT_ACCOUNT_LAYOUT } from '../../../../src/base/auth/account-layout.ts';
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
import { useMessages } from '../../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { jsonClone } from '../../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps hashing and the login timing-equalizer (`dummyVerify`) fast.
useLayers().add({
  path: '/auth-me-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  },
});

useMessages().register('en', {});
useMessages().register('de', {});
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
  get: route('GET', '/auth/me', meGetHandler as AnyHandler),
  patch: route('PATCH', '/auth/me', mePatchHandler as AnyHandler),
};

interface CallOptions {
  json?: unknown;
  cookie?: string;
}

async function call(r: Route, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  const sendBody = 'json' in options;
  if (sendBody) headers.set('Content-Type', 'application/json');
  if (options.cookie !== undefined) headers.set('Cookie', options.cookie);
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

async function signIn(email: string, password = 'correct horse'): Promise<string> {
  await queryUntyped('Users').createOrThrow({ email, password });
  return cookiePair(await call(ROUTES.login, { json: { email, password } }));
}

async function patch(cookie: string, json: unknown): Promise<Response> {
  return call(ROUTES.patch, { cookie, json });
}

async function errorsOf(response: Response): Promise<Record<string, string>> {
  strictEqual(response.status, 422);
  const body = (await response.json()) as { data: { errors: Record<string, string> } };
  return body.data.errors;
}

function defaults(user: User): User {
  return {
    UUID: user.UUID,
    email: user.email,
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

describe('GET /auth/me', () => {
  it('answers the whole user, its settings at their defaults', async () => {
    const cookie = await signIn('reader@example.com');
    const response = await call(ROUTES.get, { cookie });
    strictEqual(response.status, 200);
    const user = (await response.json()) as User;
    strictEqual(user.email, 'reader@example.com');
    deepStrictEqual(user, defaults(user));
  });

  it('answers 401 without a session', async () => {
    strictEqual((await call(ROUTES.get)).status, 401);
  });
});

describe('PATCH /auth/me', () => {
  it('round-trips every account setting and reads it back', async () => {
    const cookie = await signIn('settings@example.com');
    const settings = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      dashboardLanguage: 'de',
      contentLanguage: 'de',
      timezone: 'Europe/Berlin',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
      smartClipboard: true,
    };
    const response = await patch(cookie, settings);
    strictEqual(response.status, 200);
    const user = (await response.json()) as User;
    deepStrictEqual(user, { ...defaults(user), ...settings });
    deepStrictEqual(await (await call(ROUTES.get, { cookie })).json(), user);
  });

  it('clears a nullable setting with null', async () => {
    const cookie = await signIn('clear@example.com');
    strictEqual((await patch(cookie, { timezone: 'UTC' })).status, 200);
    const response = await patch(cookie, { timezone: null });
    strictEqual(((await response.json()) as User).timezone, null);
  });

  it('refuses a key outside the allowlist as an unknown field', async () => {
    const cookie = await signIn('strict@example.com');
    deepStrictEqual(await errorsOf(await patch(cookie, { nickname: 'x' })), {
      nickname: 'validation.unknownField',
    });
  });

  it('refuses email and roles, which only an administrator changes', async () => {
    const cookie = await signIn('fixed@example.com');
    const errors = await errorsOf(
      await patch(cookie, { email: 'other@example.com', roles: ['admin'], timezone: 'UTC' }),
    );
    deepStrictEqual(errors, { email: 'validation.unknownField', roles: 'validation.unknownField' });
    strictEqual(((await (await call(ROUTES.get, { cookie })).json()) as User).timezone, null);
  });

  it('runs the field validators and answers their messages per field', async () => {
    const cookie = await signIn('invalid@example.com');
    const errors = await errorsOf(
      await patch(cookie, { timezone: 'Mars/Olympus', dateFormat: '   ', dashboardLanguage: 'fr' }),
    );
    deepStrictEqual(errors, {
      timezone: 'auth.invalidTimezone',
      dateFormat: 'validation.emptyValue',
      dashboardLanguage: 'auth.unknownLanguage',
    });
  });

  it('answers 400 for a body that is not an object', async () => {
    const cookie = await signIn('shape@example.com');
    strictEqual((await patch(cookie, ['timezone'])).status, 400);
    strictEqual((await patch(cookie, null)).status, 400);
  });

  it('lets the auth:account-layout hook narrow the layout', async () => {
    const cookie = await signIn('narrow@example.com');
    let seen: { layout: unknown; email: string } | null = null;
    hook('auth:account-layout', (layout, context) => {
      seen = { layout: jsonClone(layout), email: context.user.email };
      return [{ card: ['timezone'] }];
    });
    try {
      deepStrictEqual(await errorsOf(await patch(cookie, { dateFormat: 'D' })), {
        dateFormat: 'validation.unknownField',
      });
      strictEqual((await patch(cookie, { timezone: 'UTC' })).status, 200);
      deepStrictEqual(seen, { layout: DEFAULT_ACCOUNT_LAYOUT, email: 'narrow@example.com' });
    } finally {
      useHooks().delete('auth:account-layout');
    }
  });

  it('refuses every change once the hook empties the layout', async () => {
    const cookie = await signIn('locked@example.com');
    hook('auth:account-layout', () => []);
    try {
      deepStrictEqual(await errorsOf(await patch(cookie, { timezone: 'UTC' })), {
        timezone: 'validation.unknownField',
      });
    } finally {
      useHooks().delete('auth:account-layout');
    }
  });

  it('changes the password, which the next login verifies, without echoing it', async () => {
    const cookie = await signIn('rotate@example.com', 'old horse');
    const response = await patch(cookie, { password: 'new horse' });
    strictEqual(response.status, 200);
    strictEqual('password' in ((await response.json()) as object), false);

    const email = 'rotate@example.com';
    strictEqual((await call(ROUTES.login, { json: { email, password: 'old horse' } })).status, 401);
    strictEqual((await call(ROUTES.login, { json: { email, password: 'new horse' } })).status, 200);
  });

  it('answers 401 without a session', async () => {
    strictEqual((await call(ROUTES.patch, { json: { timezone: 'UTC' } })).status, 401);
  });
});
