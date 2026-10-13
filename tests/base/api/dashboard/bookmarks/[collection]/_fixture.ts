import type { BookmarkEntry } from '../../../../../../src/base/bookmarks/types.ts';
import type { AnyHandler, Route } from '../../../../../../src/ohne/routes/route.ts';
import type { HTTPMethod } from '../../../../../../src/utils/index.ts';

import uuidDelete from '../../../../../../src/base/api/dashboard/bookmarks/[collection]/[uuid].delete.ts';
import uuidPatch from '../../../../../../src/base/api/dashboard/bookmarks/[collection]/[uuid].patch.ts';
import defaultPut from '../../../../../../src/base/api/dashboard/bookmarks/[collection]/default.put.ts';
import listGet from '../../../../../../src/base/api/dashboard/bookmarks/[collection]/index.get.ts';
import createPost from '../../../../../../src/base/api/dashboard/bookmarks/[collection]/index.post.ts';
import { hashSessionToken } from '../../../../../../src/base/auth/_token.ts';
import DashboardBookmarkDefaultsCollection from '../../../../../../src/base/collections/DashboardBookmarkDefaults.ts';
import DashboardBookmarksCollection from '../../../../../../src/base/collections/DashboardBookmarks.ts';
import SessionsCollection from '../../../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../../../src/base/fields/language.ts';
import localeField from '../../../../../../src/base/fields/locale.ts';
import passwordField from '../../../../../../src/base/fields/password.ts';
import rolesField from '../../../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
} from '../../../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../../../src/ohne/http/dispatch.ts';
import { DEFAULTS } from '../../../../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/bookmarks-test',
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
useCollections().register('DashboardBookmarks', {
  name: 'DashboardBookmarks',
  collection: DashboardBookmarksCollection,
});
useCollections().register('DashboardBookmarkDefaults', {
  name: 'DashboardBookmarkDefaults',
  collection: DashboardBookmarkDefaultsCollection,
});
useCollections().register('BlogPosts', {
  name: 'BlogPosts',
  collection: { api: { read: true }, fields: { title: field('text') } },
});
useCollections().register('Drafts', {
  name: 'Drafts',
  collection: { api: { read: true }, fields: { title: field('text') } },
});
useCollections().register('Secrets', {
  name: 'Secrets',
  collection: { fields: { title: field('text') } },
});
useCollections().register('Settings', {
  name: 'Settings',
  collection: {
    api: { read: true },
    singleton: true,
    fields: { title: field('text', { default: 'Site' }) },
  },
});

useRoles().register('reader', {
  name: 'reader',
  role: {
    capabilities: [
      'collection.BlogPosts.read',
      'collection.Users.read',
      'collection.Settings.read',
    ],
  },
});
useRoles().register('sharer', {
  name: 'sharer',
  role: {
    capabilities: [
      'collection.BlogPosts.read',
      'collection.Users.read',
      'dashboard.bookmarks.share',
    ],
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

/**
 * Wraps a handler module's default export as the route the router would build for it.
 */
function route(method: HTTPMethod, pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

/**
 * The bookmark routes, keyed by what they do.
 */
export const ROUTES = {
  list: route('GET', '/dashboard/bookmarks/[collection]', listGet),
  create: route('POST', '/dashboard/bookmarks/[collection]', createPost),
  patch: route('PATCH', '/dashboard/bookmarks/[collection]/[uuid]', uuidPatch),
  remove: route('DELETE', '/dashboard/bookmarks/[collection]/[uuid]', uuidDelete),
  setDefault: route('PUT', '/dashboard/bookmarks/[collection]/default', defaultPut),
};

/**
 * A stored user holding `roles`, with a live session whose token signs their requests in.
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
 * Replaces the roles of the user `uuid`, as an admin editing their account would.
 */
export async function setRoles(uuid: string, roles: string[]): Promise<void> {
  await queryUntyped('Users').where({ UUID: uuid }).updateOrThrow({ roles });
}

/**
 * What `call` sends: the route params, a bearer token, and a JSON body.
 */
export interface CallInit {
  params: Record<string, string>;
  token?: string;
  body?: unknown;
}

/**
 * Dispatches one request through `r` in-process, as the server would, with its path built from `params`.
 */
export async function call(
  r: Route,
  { params, token, body }: CallInit,
): Promise<{ status: number; body: unknown }> {
  const path = r.pattern.replaceAll(/\[(\w+)\]/g, (_, name: string) => params[name] ?? '');
  const url = `http://x.test${path}`;
  const headers = new Headers();
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: r.method ?? 'GET',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { response } = await dispatch(r, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

/**
 * Saves a bookmark of `collection` as the holder of `token`, answering the saved entry.
 */
export async function save(
  token: string,
  collection: string,
  bookmark: { name: string; view: string; shared?: boolean },
): Promise<BookmarkEntry> {
  const { status, body } = await call(ROUTES.create, {
    params: { collection },
    token,
    body: bookmark,
  });
  if (status !== 201) throw new Error(`Saving answered ${status}: ${JSON.stringify(body)}`);
  return body as BookmarkEntry;
}

/**
 * The field errors of a `422` response body.
 */
export function errorsOf(body: unknown): Record<string, string> {
  return (body as { data: { errors: Record<string, string> } }).data.errors;
}

/**
 * The `DashboardBookmarkDefaults` rows of the user `uuid`, as `{ collection, bookmark }`.
 */
export async function defaultsOf(
  uuid: string,
): Promise<{ collection: unknown; bookmark: unknown }[]> {
  const rows = await queryUntyped('DashboardBookmarkDefaults')
    .where({ user: uuid })
    .select('collection', 'bookmark')
    .findMany();
  return rows.map(({ collection, bookmark }) => ({ collection, bookmark }));
}
