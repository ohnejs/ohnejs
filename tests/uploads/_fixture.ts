import type {
  CollectionAPI,
  CollectionEndpoint,
} from '../../src/ohne/collections/define-collection.ts';
import type { DispatchOptions } from '../../src/ohne/http/dispatch.ts';
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
import UploadsSessionsCollection from '../../src/uploads/collections/UploadsSessions.ts';
import { useStorages } from '../../src/uploads/storage/use-storages.ts';
import { withSessionLock } from '../../src/uploads/uploads/_session.ts';
import { sleep } from '../../src/utils/sleep/sleep.ts';
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
useCollections().register('UploadsSessions', {
  name: 'UploadsSessions',
  collection: UploadsSessionsCollection,
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
 * Streams `head`, runs `meanwhile` once the reader asks for more, then streams `tail`.
 */
export function stalled(
  head: string,
  meanwhile: () => Promise<void>,
  tail: string,
): ReadableStream<Uint8Array> {
  const chunks = [bytes(head), bytes(tail)];
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunks.length === 1) await meanwhile();
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
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
 * Holds the lock of the session `uuid`, as a request busy with it would, until the returned `release` runs.
 * `release` resolves once the lock is free again.
 */
export async function holdSession(uuid: string): Promise<() => Promise<void>> {
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const held = withSessionLock(uuid, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  return () => {
    gate.resolve();
    return held;
  };
}

/**
 * Resolves what `pending` resolves, or `'waited'` once a second passes first.
 */
export function promptly<T>(pending: Promise<T>): Promise<T | 'waited'> {
  return Promise.race([pending, sleep(1000).then(() => 'waited' as const)]);
}

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
 * `options` reach `dispatch` as the server passes a route's resolved options, such as its `maxBodySize`.
 */
export async function call(
  r: Route,
  path: string,
  params: Record<string, string>,
  init: CallInit = {},
  options?: DispatchOptions,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.bearer !== undefined) headers.set('authorization', `Bearer ${init.bearer}`);
  if ('json' in init) headers.set('content-type', 'application/json');
  const streamed = !('json' in init) && init.body !== undefined;
  if (streamed && !headers.has('content-length')) headers.set('transfer-encoding', 'chunked');
  const body = 'json' in init ? JSON.stringify(init.json) : init.body;
  const request = new Request(`http://x.test${path}`, {
    method: r.method ?? 'GET',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
  const { response } = await dispatch(r, request, new URL(request.url), params, options);
  return response;
}

/**
 * The field errors of a `422` response body.
 */
export function errorsOf(body: unknown): Record<string, string> {
  return (body as { data: { errors: Record<string, string> } }).data.errors;
}

/**
 * Runs `run` with the `Uploads` read guarded by `access`, restoring the read afterwards.
 * `isPublic` opens that read to callers without `collection.Uploads.read`.
 */
export async function withReadAccess(
  access: CollectionEndpoint<string, 'read'>['access'],
  run: () => Promise<void>,
  isPublic = false,
): Promise<void> {
  const api = useCollections().get('Uploads')!.collection.api as CollectionAPI;
  const original = api.read;
  api.read = { public: isPublic, access };
  try {
    await run();
  } finally {
    api.read = original;
  }
}

/**
 * A read `access` that hides a row at every locale whose `description` holds `SECRET`.
 */
export const noSecrets = () => ({ where: { description: { not: { contains: 'SECRET' } } } });

/**
 * Captions the row `uuid` with `en` and `de`, one `description` per content locale.
 */
export async function caption(uuid: string, en: string, de: string): Promise<void> {
  const row = () => queryUntyped('Uploads').where({ UUID: uuid });
  await row().updateOrThrow({ description: en });
  await row().locale('de').updateOrThrow({ description: de });
}
