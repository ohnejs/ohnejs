import type { AnyHandler, Route } from '../../src/ohne/routes/route.ts';
import type { HTTPMethod } from '../../src/utils/index.ts';
import type { MemoryStorage } from './_storage.ts';

import { hashSessionToken } from '../../src/base/auth/_token.ts';
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
import { useFields } from '../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../src/ohne/http/dispatch.ts';
import { DEFAULTS } from '../../src/ohne/layers/config.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../src/ohne/query/query.ts';
import { useRoles } from '../../src/ohne/roles/use-roles.ts';
import UploadsCollection from '../../src/uploads/collections/Uploads.ts';
import UploadsJournalCollection from '../../src/uploads/collections/UploadsJournal.ts';
import { useStorages } from '../../src/uploads/storage/use-storages.ts';
import { createMemoryStorage } from './_storage.ts';

usePrinter().configure({ stream: { write: () => true } });

/**
 * The `memory` storage backend the fixture's config selects, shared by every test.
 */
export const storage: MemoryStorage = createMemoryStorage();
useStorages().register('memory', () => storage);

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/uploads-test',
  defaults: DEFAULTS,
  input: {
    uploads: { storage: 'memory', url: 'memory' },
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
useCollections().register('Uploads', { name: 'Uploads', collection: UploadsCollection });
useCollections().register('UploadsJournal', {
  name: 'UploadsJournal',
  collection: UploadsJournalCollection,
});
useRoles().register('uploads-admin', {
  name: 'uploads-admin',
  role: { capabilities: ['collection.Uploads.*'] },
});

const dialect = new SQLiteDialect();

/**
 * The in-memory SQLite the fixture registers as the process database and syncs to the collections.
 */
export const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

/**
 * Creates a user holding `roles` with a live session, returning the bearer token.
 */
export async function userWith(email: string, roles: string[]): Promise<string> {
  const user = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: user.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

/**
 * Encodes `text` as UTF-8.
 */
export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decodes `value` as UTF-8, `''` for a missing object.
 */
export function text(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}

/**
 * Streams `source` in small chunks, so a consumer's peek spans several reads.
 */
export function stream(source: Uint8Array, chunk = 5): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= source.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(source.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

/**
 * A PNG signature and `IHDR` header, enough to sniff and to measure.
 */
export function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

/**
 * A JPEG signature and `JFIF` marker, enough to sniff.
 */
export const JPEG_HEAD = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

/**
 * Wraps a handler module's default export as the route the router would build for it.
 */
export function route(method: HTTPMethod, pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/uploads',
    handler: handler as AnyHandler,
  };
}

/**
 * What `call` sends: a bearer token, a JSON body or a raw one, and extra headers.
 */
export interface CallInit {
  bearer?: string;
  json?: unknown;
  body?: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
}

/**
 * Dispatches one request through a route in-process, as the server would.
 */
export async function call(
  r: Route,
  path: string,
  params: Record<string, string>,
  init: CallInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.bearer !== undefined) headers.set('authorization', `Bearer ${init.bearer}`);
  if ('json' in init) headers.set('content-type', 'application/json');
  const body = 'json' in init ? JSON.stringify(init.json) : init.body;
  const request = new Request(`http://x.test${path}`, {
    method: r.method ?? 'GET',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
  const { response } = await dispatch(r, request, new URL(request.url), params);
  return response;
}

/**
 * The field errors of a `422` response body.
 */
export function errorsOf(body: unknown): Record<string, string> {
  return (body as { data: { errors: Record<string, string> } }).data.errors;
}
