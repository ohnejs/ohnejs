import { join as joinPath } from 'node:path';

import type { User } from '../../src/base/auth/types.ts';
import type { Config } from '../../src/ohne/layers/config.ts';
import type { AnyHandler, Route } from '../../src/ohne/routes/route.ts';

import AITurnsCollection from '../../src/ai/collections/AITurns.ts';
import aiLayer from '../../src/ai/ohne.layer.ts';
import { hashSessionToken } from '../../src/base/auth/_token.ts';
import { toUser } from '../../src/base/auth/to-user.ts';
import SessionsCollection from '../../src/base/collections/Sessions.ts';
import UsersCollection from '../../src/base/collections/Users.ts';
import datePatternField from '../../src/base/fields/date-pattern.ts';
import languageField from '../../src/base/fields/language.ts';
import localeField from '../../src/base/fields/locale.ts';
import passwordField from '../../src/base/fields/password.ts';
import rolesField from '../../src/base/fields/roles.ts';
import timezoneField from '../../src/base/fields/timezone.ts';
import { useCollections } from '../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../src/ohne/database/use-database.ts';
import { field } from '../../src/ohne/fields/field.ts';
import { useFields } from '../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../src/ohne/http/dispatch.ts';
import { DEFAULTS } from '../../src/ohne/layers/config.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';
import { scanLayerMessages } from '../../src/ohne/messages/scan-layer-messages.ts';
import { useMessages } from '../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../src/ohne/query/query.ts';
import { useRoles } from '../../src/ohne/roles/use-roles.ts';
import { collectRoutes } from '../../src/ohne/routes/collect-routes.ts';
import { routeID } from '../../src/ohne/routes/route.ts';
import { useRoutes } from '../../src/ohne/routes/use-routes.ts';

usePrinter().configure({ stream: { write: () => true } });

for (const [path, strategy] of Object.entries(aiLayer.strategies ?? {})) {
  useLayers().setStrategy(path, strategy);
}

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/ai-test',
  defaults: DEFAULTS,
  input: {
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
    auth: { password: { cost: 1024 } },
  },
});

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useCollections().register('AITurns', { name: 'AITurns', collection: AITurnsCollection });
useCollections().register('Items', {
  name: 'Items',
  collection: {
    api: { read: true, create: true, update: true, delete: true },
    dashboard: { recordLabel: 'name' },
    fields: {
      name: field('text', { translatable: true }),
      tooltip: field('text', { nullable: true, translatable: true }),
      rarity: field('select', { choices: ['common', 'rare', 'epic'], default: 'common' }),
      secret: field('text', { nullable: true, readable: false }),
    },
  },
});
useCollections().register('Guilds', {
  name: 'Guilds',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('Characters', {
  name: 'Characters',
  collection: {
    api: { read: true, create: true, update: true, delete: true },
    dashboard: { recordLabel: 'name' },
    fields: {
      name: field('text', { unique: true }),
      level: field('integer', { min: 1, max: 60, default: 1 }),
      status: field('select', { choices: ['active', 'retired'], default: 'active' }),
      guild: field('record', { collection: 'Guilds' }),
      owner: field('record', { collection: 'Users' }),
      lastLogin: field('dateTime', { nullable: true, description: 'When they last played' }),
    },
  },
});

useRoles().register('asker', { name: 'asker', role: { capabilities: ['ai.use'] } });
useRoles().register('editor', {
  name: 'editor',
  role: { capabilities: ['ai.use', 'collection.Items.update'] },
});
useRoles().register('officer', {
  name: 'officer',
  role: {
    capabilities: [
      'ai.use',
      'collection.Characters.*',
      'collection.Guilds.read',
      'collection.Items.read',
      'collection.Items.update',
    ],
  },
});
useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('reader', {
  name: 'reader',
  role: { capabilities: ['collection.Items.read'] },
});

const dialect = new SQLiteDialect();

/**
 * The in-memory SQLite the fixture registers as the process database and syncs to the collections.
 */
export const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncSchema();

/**
 * Syncs the database to every collection registered so far, for a test that registers its own.
 */
export async function syncSchema(): Promise<void> {
  await syncDatabase(db, dialect, {
    desired: buildDesiredSchema(useCollections(), useFields() as never),
  });
}

const BASE = [{ name: 'ohnejs/base', dir: joinPath(import.meta.dirname, '../../src/base') }];
for (const served of await collectRoutes(BASE)) {
  useRoutes().register(routeID(served.method, served.pattern), { ...served, handler: () => null });
}

const AI = { name: 'ohnejs/ai', dir: joinPath(import.meta.dirname, '../../src/ai') };
for (const { language, key, template } of await scanLayerMessages(AI, 'messages')) {
  useMessages().register(language, { ...useMessages().get(language), [key]: template });
}

/**
 * A session user holding `roles`, never stored.
 */
export function userWith(...roles: string[]): User {
  return toUser({ UUID: `u-${roles.join('-')}`, email: `${roles.join('-')}@example.com`, roles });
}

/**
 * A stored user holding `roles`, with a live session; the token signs their requests in.
 */
export async function signIn(
  email: string,
  roles: string[],
): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 3_600_000,
  });
  return { uuid: record.UUID as string, token };
}

/**
 * Runs `run` with the app's `ai` settings stacked over the fixture, removing them afterwards.
 */
export async function withAI(ai: Config['ai'], run: () => unknown): Promise<void> {
  useLayers().add({ path: '/ai-test/app', input: { ai } });
  try {
    await run();
  } finally {
    useLayers().remove('/ai-test/app');
  }
}

/**
 * A route for `handler` at `pattern`, bound to `method`.
 */
export function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/ai',
    handler: handler as AnyHandler,
  };
}

/**
 * What `call` takes: the request's path, its optional JSON body and bearer token, and its route params.
 */
export interface CallOptions {
  path: string;
  body?: unknown;
  token?: string;
  params?: Record<string, string>;
}

/**
 * Dispatches one request to `r` and returns the response, plus the deferred work to drain after it.
 */
export async function call(
  r: Route,
  { path, body, token, params = {} }: CallOptions,
): Promise<{ response: Response; drain: () => Promise<void> }> {
  const url = `http://x.test${path}`;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
  const request = new Request(url, {
    method: r.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { response, drain } = await dispatch(r, request, new URL(url), params);
  return { response, drain };
}
