import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { SearchResult } from '../../../src/base/collections-api/search.ts';
import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import searchPost from '../../../src/base/api/search.post.ts';
import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import { useUser } from '../../../src/base/auth/use-user.ts';
import SessionsCollection from '../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { forbidden, unauthorized } from '../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { routeID } from '../../../src/ohne/routes/route.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';
import { isNull } from '../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/search-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('item-reader', {
  name: 'item-reader',
  role: { capabilities: ['collection.SearchItems.read'] },
});

useMiddleware().register('search-block', () => unauthorized());

useCollections().register('SearchItems', {
  name: 'SearchItems',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text'), tooltip: field('text', { nullable: true }) },
  },
});
useCollections().register('SearchNotes', {
  name: 'SearchNotes',
  collection: {
    api: {
      read: {
        access: async () => {
          const user = await useUser();
          return isNull(user) ? false : { where: { owner: user.UUID }, select: ['UUID', 'title'] };
        },
      },
    },
    fields: {
      title: field('text'),
      secret: field('text', { nullable: true }),
      owner: field('text'),
    },
  },
});
useCollections().register('SearchBlocked', {
  name: 'SearchBlocked',
  collection: {
    api: { read: { public: true, middleware: ['search-block'] } },
    fields: { title: field('text') },
  },
});
useCollections().register('SearchVaults', {
  name: 'SearchVaults',
  collection: {
    api: {
      read: {
        public: true,
        access: () => {
          throw forbidden();
        },
      },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('SearchUnlabeled', {
  name: 'SearchUnlabeled',
  collection: {
    api: { read: { public: true, access: () => ({ select: ['UUID', 'note'] }) } },
    dashboard: { recordLabel: 'title' },
    fields: { title: field('text'), note: field('text') },
  },
});

useRoutes().register(routeID('POST', '/collections/[collection]/query'), {
  method: 'POST',
  pattern: '/collections/[collection]/query',
  file: '/collections/[collection]/query.ts',
  layer: 'ohnejs/base',
  handler: () => null,
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
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

async function seed(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

const admin = await userWith('admin@example.com', ['admin']);
const other = await userWith('other@example.com', ['admin']);
const reader = await userWith('reader@example.com', ['item-reader']);

const blade = await seed('SearchItems', { name: 'Ashbringer', tooltip: 'A corrupted blade' });
const lore = await seed('SearchItems', {
  name: 'Tome of lore',
  tooltip: 'Tells of the Ashbringer',
});
const helm = await seed('SearchItems', { name: 'Helm of Ashbringer' });
const mine = await seed('SearchNotes', { title: 'Mine ashbringer', owner: admin.uuid });
await seed('SearchNotes', { title: 'Theirs ashbringer', owner: other.uuid });
await seed('SearchNotes', { title: 'Quiet', secret: 'ashbringer', owner: admin.uuid });
await seed('SearchBlocked', { title: 'Blocked ashbringer' });
await seed('SearchVaults', { title: 'Vault ashbringer' });
await seed('SearchUnlabeled', { title: 'Unlabeled', note: 'ashbringer' });

const ROUTE: Route = {
  method: 'POST',
  pattern: '/search',
  file: '/search.ts',
  layer: 'ohnejs/base',
  handler: searchPost as AnyHandler,
};

async function search(
  body: unknown,
  bearer: string | null,
): Promise<{ status: number; body: { results: SearchResult[] } }> {
  const url = 'http://x.test/search';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const { response } = await dispatch(ROUTE, request, new URL(url), {});
  return { status: response.status, body: (await response.json()) as { results: SearchResult[] } };
}

describe('POST /search', () => {
  it('finds a record by any readable text field, the closest label first', async () => {
    const { status, body } = await search({ q: 'ASHBRINGER' }, admin.token);
    strictEqual(status, 200);
    deepStrictEqual(body.results, [
      { collection: 'SearchItems', UUID: blade, label: 'Ashbringer' },
      { collection: 'SearchNotes', UUID: mine, label: 'Mine ashbringer' },
      { collection: 'SearchItems', UUID: helm, label: 'Helm of Ashbringer' },
      { collection: 'SearchItems', UUID: lore, label: 'Tome of lore' },
    ]);
  });

  it('matches only records holding every token', async () => {
    const { body } = await search({ q: '  corrupted   ashbringer ' }, admin.token);
    deepStrictEqual(body.results, [
      { collection: 'SearchItems', UUID: blade, label: 'Ashbringer' },
    ]);
    deepStrictEqual((await search({ q: 'ashbringer frostmourne' }, admin.token)).body.results, []);
  });

  it('answers nothing for a blank query', async () => {
    deepStrictEqual((await search({ q: '   ' }, admin.token)).body, { results: [] });
  });

  it('caps the records per collection at `limit`', async () => {
    const { body } = await search({ q: 'ashbringer', limit: 1 }, admin.token);
    deepStrictEqual(body.results.map((result) => result.collection).toSorted(), [
      'SearchItems',
      'SearchNotes',
    ]);
  });

  it('respects the read scope and never searches a field outside it', async () => {
    const { body } = await search({ q: 'ashbringer' }, admin.token);
    const notes = body.results.filter((result) => result.collection === 'SearchNotes');
    deepStrictEqual(notes, [{ collection: 'SearchNotes', UUID: mine, label: 'Mine ashbringer' }]);
  });

  it('skips a collection whose scope hides every label field', async () => {
    const { body } = await search({ q: 'ashbringer' }, admin.token);
    strictEqual(
      body.results.some((result) => result.collection === 'SearchUnlabeled'),
      false,
    );
  });

  it('skips a collection the caller may not read, however its read refuses', async () => {
    const { status, body } = await search({ q: 'ashbringer' }, reader.token);
    strictEqual(status, 200);
    deepStrictEqual(
      body.results.map((result) => result.UUID),
      [blade, helm, lore],
    );
  });

  it('refuses a guest, an unknown key, a non-string `q`, and a bad `limit`', async () => {
    strictEqual((await search({ q: 'ashbringer' }, null)).status, 401);
    strictEqual((await search({ q: 'a', page: 1 }, admin.token)).status, 400);
    strictEqual((await search({ q: 1 }, admin.token)).status, 400);
    strictEqual((await search({}, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', limit: 0 }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', limit: 1.5 }, admin.token)).status, 400);
  });
});
