import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../src/ohne/database/adapter.ts';
import type { QueryScope } from '../../../../src/ohne/query/wire/apply.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import translationsDelete from '../../../../src/base/api/collections/[collection]/[uuid]/translations.delete.ts';
import verdictsPost from '../../../../src/base/api/collections/[collection]/verdicts.post.ts';
import { hashSessionToken } from '../../../../src/base/auth/_token.ts';
import { useUser } from '../../../../src/base/auth/use-user.ts';
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
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { notFound, unauthorized } from '../../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import { isNull } from '../../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/verdicts-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
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

useRoles().register('vd-writer', {
  name: 'vd-writer',
  role: { capabilities: ['collection.VdNotes.*'] },
});
useRoles().register('vd-reader', {
  name: 'vd-reader',
  role: { capabilities: ['collection.VdNotes.read'] },
});

const own = async (): Promise<QueryScope | boolean> => {
  const user = await useUser();
  return isNull(user) ? false : { where: { owner: user.UUID } };
};
const published = (): QueryScope => ({ where: { published: true } });

useCollections().register('VdOpen', {
  name: 'VdOpen',
  collection: {
    api: { read: 'public', update: 'public', delete: 'public' },
    fields: { title: field('text') },
  },
});
useCollections().register('VdRefused', {
  name: 'VdRefused',
  collection: {
    api: {
      read: 'public',
      update: { public: true, access: () => false },
      delete: { public: true, access: () => false },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('VdNotes', {
  name: 'VdNotes',
  collection: {
    api: { read: true, update: { access: own }, delete: { access: own } },
    fields: { title: field('text'), owner: field('text') },
  },
});
useCollections().register('VdClosed', {
  name: 'VdClosed',
  collection: {
    api: { read: 'public', update: 'public' },
    fields: { title: field('text') },
  },
});
useCollections().register('VdGate', {
  name: 'VdGate',
  collection: {
    api: { read: { public: true, access: () => false }, update: 'public' },
    fields: { title: field('text') },
  },
});
useCollections().register('VdUnexposed', {
  name: 'VdUnexposed',
  collection: { api: { update: 'public' }, fields: { title: field('text') } },
});

let readRuns = 0;
let writeRuns = 0;
useMiddleware().register('vd-read', () => void (readRuns += 1));
useMiddleware().register('vd-write', () => void (writeRuns += 1));
useMiddleware().register('vd-block', () => unauthorized());

useCollections().register('VdMiddleware', {
  name: 'VdMiddleware',
  collection: {
    api: {
      read: { public: true, middleware: ['vd-read'] },
      update: { public: true, middleware: ['vd-write'], access: () => true },
      delete: { public: true, middleware: ['vd-write'], access: () => true },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('VdBlocked', {
  name: 'VdBlocked',
  collection: {
    api: { read: { public: true, middleware: ['vd-block'] }, update: 'public' },
    fields: { title: field('text') },
  },
});
useCollections().register('VdHidden', {
  name: 'VdHidden',
  collection: {
    api: {
      read: { public: true, access: () => ({ where: { visible: true } }) },
      update: 'public',
      delete: { public: true, access: () => ({ where: { locked: false } }) },
    },
    fields: { title: field('text'), visible: field('boolean'), locked: field('boolean') },
  },
});

const contexts: unknown[] = [];
const noteContext = (context: unknown): true => (contexts.push(context), true);
useCollections().register('VdContexts', {
  name: 'VdContexts',
  collection: {
    api: {
      read: { public: true, access: noteContext },
      update: { public: true, access: noteContext },
      delete: { public: true, access: noteContext },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('VdRefusing', {
  name: 'VdRefusing',
  collection: {
    api: {
      read: 'public',
      update: {
        public: true,
        access: () => {
          throw unauthorized();
        },
      },
      delete: {
        public: true,
        access: () => {
          throw notFound();
        },
      },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('VdBroken', {
  name: 'VdBroken',
  collection: {
    api: {
      read: 'public',
      update: {
        public: true,
        access: () => {
          throw new TypeError('broken scope');
        },
      },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('VdSelect', {
  name: 'VdSelect',
  collection: {
    api: {
      read: 'public',
      update: { public: true, access: () => ({ select: ['title'] }) },
      delete: 'public',
    },
    fields: { title: field('text'), note: field('text') },
  },
});
useCollections().register('VdPosts', {
  name: 'VdPosts',
  collection: {
    api: {
      read: 'public',
      update: { public: true, access: published },
      delete: { public: true, access: published },
    },
    fields: {
      title: field('text', { translatable: true }),
      published: field('boolean', { translatable: true }),
    },
  },
});
useCollections().register('VdLocal', {
  name: 'VdLocal',
  collection: {
    api: {
      read: { public: true, access: published },
      update: { public: true, access: published },
      delete: { public: true, access: () => ({ where: { owner: 'me' } }) },
    },
    fields: {
      title: field('text', { translatable: true }),
      published: field('boolean', { translatable: true }),
      owner: field('text'),
    },
  },
});
useCollections().register('VdWalk', {
  name: 'VdWalk',
  collection: {
    api: {
      read: { public: true, access: () => ({ where: { listed: true }, limit: 5 }) },
      update: { public: true, access: published },
      delete: { public: true, access: published },
    },
    fields: {
      published: field('boolean', { translatable: true }),
      listed: field('boolean'),
      batch: field('text'),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

let queries = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
    return db.query<T>(sql, params);
  },
  queryOne: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
    return db.queryOne<T>(sql, params);
  },
  transaction: (fn) => db.transaction(fn),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return { uuid: record.UUID as string, token };
}

const writer = await userWith('writer@example.com', ['vd-writer']);
const other = await userWith('other@example.com', ['vd-writer']);
const reader = await userWith('reader@example.com', ['vd-reader']);
const outsider = await userWith('outsider@example.com', []);

async function seed(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

/**
 * Seeds a translatable record published at exactly the named locales.
 */
async function seedPublished(
  collection: string,
  locales: string[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const uuid = await seed(collection, { ...extra, title: 'en', published: locales.includes('en') });
  await queryUntyped(collection)
    .locale('de')
    .where({ UUID: uuid })
    .updateOrThrow({ title: 'de', published: locales.includes('de') });
  return uuid;
}

const openRow = await seed('VdOpen', { title: 'Open' });
const refusedRow = await seed('VdRefused', { title: 'Refused' });
const writerNote = await seed('VdNotes', { title: 'Writer note', owner: writer.uuid });
const otherNote = await seed('VdNotes', { title: 'Other note', owner: other.uuid });
const readerNote = await seed('VdNotes', { title: 'Reader note', owner: reader.uuid });
const closedRow = await seed('VdClosed', { title: 'Closed' });
const middlewareRow = await seed('VdMiddleware', { title: 'Middleware' });
const shown = await seed('VdHidden', { title: 'Shown', visible: true, locked: false });
const shownLocked = await seed('VdHidden', { title: 'Locked', visible: true, locked: true });
const hidden = await seed('VdHidden', { title: 'Hidden', visible: false, locked: false });
const contextRow = await seed('VdContexts', { title: 'Context' });
const refusingRow = await seed('VdRefusing', { title: 'Refusing' });
const brokenRow = await seed('VdBroken', { title: 'Broken' });
const selectRow = await seed('VdSelect', { title: 'Select', note: 'locked' });
const atEN = await seedPublished('VdPosts', ['en']);
const atDE = await seedPublished('VdPosts', ['de']);
const localAtDE = await seedPublished('VdLocal', ['de'], { owner: 'me' });

const WALK_ROWS = 1000;
const LISTED_ROWS = 990;
const walkID = (n: number): string => `00000000-0000-7000-8000-${n.toString().padStart(12, '0')}`;

await db.transaction(async (tx) => {
  for (let n = 1; n <= WALK_ROWS; n += 1) {
    await tx.run('INSERT INTO "VdWalk" ("UUID","_updatedAt","listed","batch") VALUES (?,?,?,?)', [
      walkID(n),
      0,
      n <= LISTED_ROWS ? 1 : 0,
      n <= 950 ? 'a' : 'b',
    ]);
    await tx.run(
      'INSERT INTO "VdWalk__translations" ("_parentUUID","_localeCode","published") VALUES (?,?,?)',
      [walkID(n), 'en', n % 2 === 0 ? 1 : 0],
    );
    await tx.run(
      'INSERT INTO "VdWalk__translations" ("_parentUUID","_localeCode","published") VALUES (?,?,?)',
      [walkID(n), 'de', n % 3 === 0 ? 1 : 0],
    );
  }
});

const walkIDs = (count: number): string[] => Array.from({ length: count }, (_, i) => walkID(i + 1));
const multiples = (of: number, upTo: number): string[] =>
  walkIDs(upTo).filter((_, i) => (i + 1) % of === 0);

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const VERDICTS = route('POST', '/collections/[collection]/verdicts', verdictsPost);
const DELETE = route('DELETE', '/collections/[collection]/[uuid]', uuidDelete);
const DELETE_TRANSLATION = route(
  'DELETE',
  '/collections/[collection]/[uuid]/translations',
  translationsDelete,
);

interface CallResult {
  status: number;
  body: unknown;
}

async function send(
  target: Route,
  path: string,
  params: Record<string, string>,
  init: { body?: unknown; bearer?: string | null } = {},
): Promise<CallResult> {
  const url = `http://x.test/collections/${path}`;
  const headers = new Headers();
  if (init.bearer) headers.set('Authorization', `Bearer ${init.bearer}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: target.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const { response } = await dispatch(target, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

function ask(
  collection: string,
  body: unknown,
  bearer: string | null = null,
  qs = '',
): Promise<CallResult> {
  return send(VERDICTS, `${collection}/verdicts${qs}`, { collection }, { body, bearer });
}

function dataOf(result: CallResult): unknown {
  return (result.body as { data?: unknown }).data;
}

describe('POST /collections/[collection]/verdicts - the row form', () => {
  it('names every asked row under scopes without a `where`, running no query', async () => {
    queries = 0;
    const { status, body } = await ask('vd-open', { UUIDs: [openRow, 'missing'] });
    strictEqual(status, 200);
    deepStrictEqual(body, {
      update: { UUIDs: [openRow, 'missing'] },
      delete: { UUIDs: [openRow, 'missing'] },
    });
    strictEqual(queries, 0);
  });

  it('names no row under a `false` verdict, running no query', async () => {
    queries = 0;
    const { status, body } = await ask('vd-refused', { UUIDs: [refusedRow] });
    strictEqual(status, 200);
    deepStrictEqual(body, { update: { UUIDs: [] }, delete: { UUIDs: [] } });
    strictEqual(queries, 0);
  });

  it('names the exact subset a scope `where` admits, in the asked order', async () => {
    const UUIDs = [otherNote, writerNote];
    deepStrictEqual((await ask('vd-notes', { UUIDs }, writer.token)).body, {
      update: { UUIDs: [writerNote] },
      delete: { UUIDs: [writerNote] },
    });
    deepStrictEqual((await ask('vd-notes', { UUIDs }, other.token)).body, {
      update: { UUIDs: [otherNote] },
      delete: { UUIDs: [otherNote] },
    });
  });

  it('names no row for a closed operation', async () => {
    deepStrictEqual((await ask('vd-closed', { UUIDs: [closedRow] })).body, {
      update: { UUIDs: [closedRow] },
      delete: { UUIDs: [] },
    });
  });

  it('names no row for an operation the caller lacks the capability for', async () => {
    const { status, body } = await ask('vd-notes', { UUIDs: [readerNote] }, reader.token);
    strictEqual(status, 200);
    deepStrictEqual(body, { update: { UUIDs: [] }, delete: { UUIDs: [] } });
  });

  it('never names a row the read scope hides', async () => {
    const { body } = await ask('vd-hidden', { UUIDs: [hidden, shown, 'missing', shownLocked] });
    deepStrictEqual(body, {
      update: { UUIDs: [shown, shownLocked] },
      delete: { UUIDs: [shown] },
    });
  });

  it('collapses duplicate `UUIDs`', async () => {
    const { body } = await ask('vd-open', { UUIDs: [openRow, openRow] });
    deepStrictEqual(body, { update: { UUIDs: [openRow] }, delete: { UUIDs: [openRow] } });
  });

  it('carries the update scope`s `select`', async () => {
    deepStrictEqual((await ask('vd-select', { UUIDs: [selectRow] })).body, {
      update: { UUIDs: [selectRow], select: ['title'] },
      delete: { UUIDs: [selectRow] },
    });
  });

  it('chunks past 900 `UUIDs`, one probe per chunk and scope', async () => {
    queries = 0;
    const within = await ask('vd-walk', { UUIDs: walkIDs(900) });
    deepStrictEqual(within.body, {
      update: { UUIDs: multiples(2, 900) },
      delete: { UUIDs: multiples(2, 900) },
      deleteTranslation: { UUIDs: multiples(2, 900) },
    });
    strictEqual(queries, 3);

    queries = 0;
    const past = await ask('vd-walk', { UUIDs: walkIDs(902) });
    deepStrictEqual(past.body, {
      update: { UUIDs: multiples(2, 902) },
      delete: { UUIDs: multiples(2, 902) },
      deleteTranslation: { UUIDs: multiples(2, 902) },
    });
    strictEqual(queries, 6);
  });
});

describe('POST /collections/[collection]/verdicts - the gate', () => {
  it('404s an unknown collection, an unexposed read, and a `false` read verdict', async () => {
    strictEqual((await ask('vd-nothing', { UUIDs: [] })).status, 404);
    strictEqual((await ask('vd-unexposed', { UUIDs: [] })).status, 404);
    strictEqual((await ask('vd-gate', { UUIDs: [] })).status, 404);
  });

  it('401s a guarded read without a user and 403s one without the capability', async () => {
    strictEqual((await ask('vd-notes', { UUIDs: [writerNote] })).status, 401);
    strictEqual((await ask('vd-notes', { UUIDs: [writerNote] }, outsider.token)).status, 403);
  });

  it('runs the read middleware and never the write middleware', async () => {
    readRuns = 0;
    writeRuns = 0;
    const { status, body } = await ask('vd-middleware', { UUIDs: [middlewareRow] });
    strictEqual(status, 200);
    deepStrictEqual(body, {
      update: { UUIDs: [middlewareRow] },
      delete: { UUIDs: [middlewareRow] },
    });
    strictEqual(readRuns, 1);
    strictEqual(writeRuns, 0);
  });

  it('answers with a read middleware`s answer', async () => {
    strictEqual((await ask('vd-blocked', { UUIDs: [] })).status, 401);
  });

  it('resolves the read, then an update with an empty input, then the delete', async () => {
    contexts.length = 0;
    strictEqual((await ask('vd-contexts', { UUIDs: [contextRow] })).status, 200);
    deepStrictEqual(contexts, [
      { operation: 'read' },
      { operation: 'update', input: {} },
      { operation: 'delete' },
    ]);
  });

  it('names no row when a write resolver throws an `HTTPError`', async () => {
    const { status, body } = await ask('vd-refusing', { UUIDs: [refusingRow] });
    strictEqual(status, 200);
    deepStrictEqual(body, { update: { UUIDs: [] }, delete: { UUIDs: [] } });
  });

  it('500s when a write resolver throws anything else', async () => {
    strictEqual((await ask('vd-broken', { UUIDs: [brokenRow] })).status, 500);
  });
});

describe('POST /collections/[collection]/verdicts - locales', () => {
  it('reads every verdict at the default locale when the body names none', async () => {
    deepStrictEqual((await ask('vd-posts', { UUIDs: [atEN, atDE] })).body, {
      update: { UUIDs: [atEN] },
      delete: { UUIDs: [atEN] },
      deleteTranslation: { UUIDs: [atEN] },
    });
  });

  it('reads `update` and `deleteTranslation` at `locale`, `delete` at the default', async () => {
    deepStrictEqual((await ask('vd-posts', { UUIDs: [atEN, atDE], locale: 'de' })).body, {
      update: { UUIDs: [atDE] },
      delete: { UUIDs: [atEN] },
      deleteTranslation: { UUIDs: [atDE] },
    });
  });

  it('probes `deleteTranslation` only when it can differ from `delete`', async () => {
    queries = 0;
    await ask('vd-posts', { UUIDs: [atEN, atDE] });
    strictEqual(queries, 2);

    queries = 0;
    await ask('vd-posts', { UUIDs: [atEN, atDE], locale: 'de' });
    strictEqual(queries, 3);

    queries = 0;
    await ask('vd-local', { UUIDs: [localAtDE], locale: 'de' });
    strictEqual(queries, 3);
  });

  it('keeps the delete verdict of a row readable at `de` only', async () => {
    deepStrictEqual((await ask('vd-local', { UUIDs: [localAtDE], locale: 'de' })).body, {
      update: { UUIDs: [localAtDE] },
      delete: { UUIDs: [localAtDE] },
      deleteTranslation: { UUIDs: [localAtDE] },
    });
    deepStrictEqual((await ask('vd-local', { UUIDs: [localAtDE] })).body, {
      update: { UUIDs: [] },
      delete: { UUIDs: [] },
      deleteTranslation: { UUIDs: [] },
    });
  });

  it('predicts the deletes: the whole record at the default locale, a translation at `locale`', async () => {
    const onlyEN = await seedPublished('VdPosts', ['en']);
    const onlyDE = await seedPublished('VdPosts', ['de']);
    deepStrictEqual((await ask('vd-posts', { UUIDs: [onlyEN, onlyDE], locale: 'de' })).body, {
      update: { UUIDs: [onlyDE] },
      delete: { UUIDs: [onlyEN] },
      deleteTranslation: { UUIDs: [onlyDE] },
    });

    const posts = { collection: 'vd-posts' };
    const whole = (uuid: string): Promise<CallResult> =>
      send(DELETE, `vd-posts/${uuid}`, { ...posts, uuid });
    const translation = (uuid: string, qs = ''): Promise<CallResult> =>
      send(DELETE_TRANSLATION, `vd-posts/${uuid}/translations${qs}`, { ...posts, uuid });

    strictEqual((await whole(onlyDE)).status, 404);
    strictEqual((await translation(onlyEN, '?locale=de')).status, 404);
    strictEqual((await translation(onlyDE)).status, 404);
    strictEqual((await translation(onlyDE, '?locale=de')).status, 204);
    strictEqual((await whole(onlyEN)).status, 204);
  });
});

describe('POST /collections/[collection]/verdicts - the query form', () => {
  it('counts the whole list once under scopes without a `where`', async () => {
    queries = 0;
    const { status, body } = await ask('vd-open', {});
    strictEqual(status, 200);
    deepStrictEqual(body, { update: { total: 1 }, delete: { total: 1 } });
    strictEqual(queries, 1);
  });

  it('counts nothing under a `false` verdict, running no query', async () => {
    queries = 0;
    deepStrictEqual((await ask('vd-refused', {})).body, {
      update: { total: 0 },
      delete: { total: 0 },
    });
    strictEqual(queries, 0);
  });

  it('counts under the read scope and the wire `where`', async () => {
    deepStrictEqual((await ask('vd-hidden', {})).body, {
      update: { total: 2 },
      delete: { total: 1 },
    });
    deepStrictEqual((await ask('vd-hidden', { where: { title: 'Locked' } })).body, {
      update: { total: 1 },
      delete: { total: 0 },
    });
    deepStrictEqual((await ask('vd-notes', {}, writer.token)).body, {
      update: { total: 1 },
      delete: { total: 1 },
    });
  });

  it('carries the update scope`s `select`', async () => {
    deepStrictEqual((await ask('vd-select', {})).body, {
      update: { total: 1, select: ['title'] },
      delete: { total: 1 },
    });
  });

  it('counts in one statement per scope when one locale suffices', async () => {
    queries = 0;
    deepStrictEqual((await ask('vd-walk', {})).body, {
      update: { total: 495 },
      delete: { total: 495 },
      deleteTranslation: { total: 495 },
    });
    strictEqual(queries, 2);
  });

  it('walks the list in bounded steps when the verdict reads another locale', async () => {
    queries = 0;
    deepStrictEqual((await ask('vd-walk', { locale: 'de' })).body, {
      update: { total: 330 },
      delete: { total: 495 },
      deleteTranslation: { total: 330 },
    });
    strictEqual(queries, 6);

    deepStrictEqual((await ask('vd-walk', { locale: 'de', where: { batch: 'a' } })).body, {
      update: { total: 316 },
      delete: { total: 475 },
      deleteTranslation: { total: 316 },
    });
  });
});

describe('POST /collections/[collection]/verdicts - under a lowered `maxLimit`', () => {
  before(() =>
    useLayers().add({ path: '/verdicts-max-limit', input: { query: { guards: { maxLimit: 2 } } } }),
  );
  after(() => useLayers().remove('/verdicts-max-limit'));

  it('names every admitted row of a batch past `maxLimit`', async () => {
    deepStrictEqual((await ask('vd-walk', { UUIDs: walkIDs(10) })).body, {
      update: { UUIDs: multiples(2, 10) },
      delete: { UUIDs: multiples(2, 10) },
      deleteTranslation: { UUIDs: multiples(2, 10) },
    });
  });

  it('walks every listed row past `maxLimit`', async () => {
    deepStrictEqual((await ask('vd-walk', { locale: 'de' })).body, {
      update: { total: 330 },
      delete: { total: 495 },
      deleteTranslation: { total: 330 },
    });
  });
});

describe('POST /collections/[collection]/verdicts - the body', () => {
  it('rejects a URL param', async () => {
    const result = await ask('vd-open', { UUIDs: [] }, null, '?locale=en');
    strictEqual(result.status, 400);
    deepStrictEqual(dataOf(result), { code: 'unknownParam', path: 'locale' });
  });

  it('rejects an unknown body key', async () => {
    const result = await ask('vd-open', { UUIDs: [], select: ['title'] });
    strictEqual(result.status, 400);
    deepStrictEqual(dataOf(result), { code: 'unknownParam', path: 'select' });
  });

  it('rejects `where` beside `UUIDs`', async () => {
    const result = await ask('vd-open', { UUIDs: [openRow], where: { title: 'Open' } });
    strictEqual(result.status, 400);
    deepStrictEqual(dataOf(result), { code: 'invalidValue', path: 'where' });
  });

  it('rejects `UUIDs` that is not an array of strings', async () => {
    for (const UUIDs of [openRow, null, [openRow, 1], { 0: openRow }]) {
      const result = await ask('vd-open', { UUIDs });
      strictEqual(result.status, 400);
      deepStrictEqual(dataOf(result), { code: 'invalidValue', path: 'UUIDs' });
    }
  });

  it('rejects `UUIDs` longer than `maxInLength`', async () => {
    const result = await ask('vd-open', { UUIDs: walkIDs(2001) });
    strictEqual(result.status, 400);
    deepStrictEqual(dataOf(result), { code: 'listTooLong', path: 'UUIDs' });
  });

  it('validates `locale` in both forms', async () => {
    const row = await ask('vd-posts', { UUIDs: [atEN], locale: 'xx' });
    strictEqual(row.status, 400);
    deepStrictEqual(dataOf(row), { code: 'invalidLocale', path: 'locale' });

    const query = await ask('vd-posts', { locale: 'xx' });
    strictEqual(query.status, 400);
    deepStrictEqual(dataOf(query), { code: 'invalidLocale', path: 'locale' });

    const plain = await ask('vd-open', { UUIDs: [openRow], locale: 'en' });
    strictEqual(plain.status, 400);
    deepStrictEqual(dataOf(plain), { code: 'localeNotApplicable', path: 'locale' });
  });

  it('parses the query form`s `where` as the list read does', async () => {
    const result = await ask('vd-open', { where: { nope: 1 } });
    strictEqual(result.status, 400);
    deepStrictEqual(dataOf(result), { code: 'invalidField', path: 'where.nope' });
  });
});
