import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { SearchResult } from '../../../src/base/collections-api/search.ts';
import type { FieldTypeName } from '../../../src/ohne/fields/known-fields.ts';
import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import searchPost from '../../../src/base/api/search.post.ts';
import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import { requireUser } from '../../../src/base/auth/require-user.ts';
import { useUser } from '../../../src/base/auth/use-user.ts';
import { searchRecords } from '../../../src/base/collections-api/search.ts';
import SessionsCollection from '../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { seedSingletons } from '../../../src/ohne/database/seed-singletons.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { forbidden, tooManyRequests, unauthorized } from '../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { routeID } from '../../../src/ohne/routes/route.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';
import { isNull } from '../../../src/utils/index.ts';

const printed: string[] = [];
usePrinter().configure({
  stream: {
    write: (chunk: string) => {
      printed.push(chunk);
      return true;
    },
  },
});

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/search-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  },
});

let sealed = false;
let tripwire: AbortController | null = null;

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useFields().register('searchSealed', {
  name: 'searchSealed' as FieldTypeName,
  fieldType: defineField({
    columnType: 'text',
    deserialize: (value) => {
      if (sealed) throw forbidden();
      return value;
    },
  }),
});
useFields().register('searchLoose', {
  name: 'searchLoose' as FieldTypeName,
  fieldType: defineField({
    columnType: 'text',
    search: ({ token }) => (token === 'loose' ? { isNull: true } : null),
  }),
});
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('item-reader', {
  name: 'item-reader',
  role: { capabilities: ['collection.SearchItems.read'] },
});

useMiddleware().register('search-block', () => unauthorized());
useMiddleware().register('search-throw', () => {
  throw tooManyRequests();
});

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

useBlocks().register('SearchHero', {
  name: 'SearchHero',
  block: {
    fields: { heading: field('text'), author: field('record', { collection: 'SearchItems' }) },
  },
});
useBlocks().register('SearchStack', {
  name: 'SearchStack',
  block: { fields: { parts: field('blocks', { allow: ['SearchStack', 'SearchHero'] }) } },
});
useCollections().register('SearchPages', {
  name: 'SearchPages',
  collection: {
    api: { read: true },
    fields: {
      title: field('text'),
      body: field('blocks', { allow: ['SearchHero', 'SearchStack'] }),
      meta: field('object', { fields: { summary: field('text', { nullable: true }) } }),
    },
  },
});
useCollections().register('SearchTasks', {
  name: 'SearchTasks',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'title' },
    fields: {
      title: field('text'),
      status: field('select', { choices: [{ value: 'wip', label: 'In progress' }, 'done'] }),
      due: field('date', { nullable: true }),
      points: field('integer', { default: 0, search: true }),
      effort: field('integer', { default: 0 }),
      hidden: field('text', { nullable: true, search: false }),
      details: field('object', {
        search: false,
        fields: { note: field('text', { nullable: true }) },
      }),
    },
  },
});
useCollections().register('SearchSecrets', {
  name: 'SearchSecrets',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name', search: false },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchTags', {
  name: 'SearchTags',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name', search: { via: false } },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchSettings', {
  name: 'SearchSettings',
  collection: {
    api: { read: true },
    singleton: true,
    fields: { motto: field('text', { nullable: true }) },
  },
});
useCollections().register('SearchSealed', {
  name: 'SearchSealed',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('searchSealed' as FieldTypeName) },
  },
});
useCollections().register('SearchThrottled', {
  name: 'SearchThrottled',
  collection: {
    api: { read: { public: true, middleware: ['search-throw'] } },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchKeeps', {
  name: 'SearchKeeps',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchTripwires', {
  name: 'SearchTripwires',
  collection: {
    api: {
      read: {
        access: () => {
          tripwire?.abort();
          return {};
        },
      },
    },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchDocs', {
  name: 'SearchDocs',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'title' },
    fields: { title: field('text', { translatable: true }) },
  },
});
useCollections().register('SearchInvoices', {
  name: 'SearchInvoices',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'Invoice {code}' },
    fields: { code: field('text'), memo: field('text', { nullable: true }) },
  },
});
useCollections().register('SearchLedgers', {
  name: 'SearchLedgers',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchBulk', {
  name: 'SearchBulk',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('text') },
  },
});
useCollections().register('SearchLoose', {
  name: 'SearchLoose',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'name' },
    fields: { name: field('searchLoose' as FieldTypeName) },
  },
});
useCollections().register('SearchWide', {
  name: 'SearchWide',
  collection: {
    api: { read: true },
    dashboard: { recordLabel: 'f01' },
    fields: Object.fromEntries(
      Array.from({ length: 11 }, (_, at) => [`f${String(at + 1).padStart(2, '0')}`, field('text')]),
    ),
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
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});
await seedSingletons();

async function userWith(
  email: string,
  roles: string[],
  extra: Record<string, unknown> = {},
): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({
    email,
    password: 'pw-123456',
    roles,
    ...extra,
  });
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
const germanUser = await userWith('german@example.com', ['admin'], { contentLanguage: 'de' });

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
const unlabeled = await seed('SearchUnlabeled', { title: 'Unlabeled', note: 'ashbringer' });
const STORED_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
await seed('SearchItems', { name: 'Forge', tooltip: `Forged after ${STORED_UUID}` });
const stackedPage = await queryUntyped('SearchPages').createOrThrow({
  title: 'Stacked',
  body: [
    {
      block: 'SearchStack',
      fields: {
        parts: [{ block: 'SearchHero', fields: { heading: 'Frozen throne', author: blade } }],
      },
    },
  ],
  meta: { summary: null },
});
const stacked = stackedPage.UUID as string;
const stackItem = (stackedPage.body as { UUID: string; fields: Record<string, unknown> }[])[0];
const heroItem = (stackItem.fields.parts as { UUID: string }[])[0].UUID;
const summedPage = await queryUntyped('SearchPages').createOrThrow({
  title: 'Summed',
  body: [],
  meta: { summary: 'Lordaeron falls' },
});
const summed = summedPage.UUID as string;
const summedItem = (summedPage.meta as { UUID: string }).UUID;
const inProgress = await seed('SearchTasks', {
  title: 'Paint the hall',
  status: 'wip',
  due: '2026-03-14',
  points: 42,
  hidden: 'classified',
  details: { note: 'buried' },
});
const finished = await seed('SearchTasks', {
  title: 'Sweep the yard',
  status: 'done',
  effort: 42,
  details: { note: null },
});
const secret = await seed('SearchSecrets', { name: 'Hidden grove' });
const tag = await seed('SearchTags', { name: 'Grove tag' });
await queryUntyped('SearchSettings').updateOrThrow({ motto: 'Grove forever' });
const settings = (await queryUntyped('SearchSettings').findFirst())?.UUID as string;
await seed('SearchSealed', { name: 'Wyrmrest sealed' });
sealed = true;
await seed('SearchThrottled', { name: 'Wyrmrest throttled' });
const keep = await seed('SearchKeeps', { name: 'Wyrmrest keep' });
const trip = await seed('SearchTripwires', { name: 'Wyrmrest tripwire' });
const harbor = await seed('SearchDocs', { title: 'Harbor' });
await queryUntyped('SearchDocs').locale('de').where({ UUID: harbor }).updateOrThrow({
  title: 'Hafen',
});
const invoice = await seed('SearchInvoices', { code: 'A-17', memo: 'Billed invoice' });
const ledger = await seed('SearchLedgers', { name: 'Invoice ledger' });
for (let at = 0; at < 52; at += 1) await seed('SearchBulk', { name: 'Bulk' });
await seed('SearchLoose', { name: 'Loose' });
const wide = await seed(
  'SearchWide',
  Object.fromEntries(
    Array.from({ length: 11 }, (_, at) => [
      `f${String(at + 1).padStart(2, '0')}`,
      `wide ${at + 1}`,
    ]),
  ),
);

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
  route = ROUTE,
  signal?: AbortSignal,
): Promise<{ status: number; body: { results: SearchResult[] } }> {
  const url = 'http://x.test/search';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const init = { method: 'POST', headers, body: JSON.stringify(body), signal };
  const request = new Request(url, init);
  const { response } = await dispatch(route, request, new URL(url), {});
  return { status: response.status, body: (await response.json()) as { results: SearchResult[] } };
}

/**
 * Runs `searchRecords` inside a request for `q`, under `signal`.
 */
async function searchUnder(q: string, signal: AbortSignal): Promise<SearchResult[]> {
  const route: Route = {
    ...ROUTE,
    handler: (async () => ({
      results: await searchRecords(await requireUser(), q, { limit: 5, signal }),
    })) as AnyHandler,
  };
  return (await search({}, admin.token, route)).body.results;
}

async function found(q: string, bearer = admin.token): Promise<SearchResult[]> {
  return (await search({ q }, bearer)).body.results;
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

  it('matches a quoted run as one phrase', async () => {
    const { body } = await search({ q: '"of the  ashbringer"' }, admin.token);
    deepStrictEqual(body.results, [
      { collection: 'SearchItems', UUID: lore, label: 'Tome of lore' },
    ]);
  });

  it('ignores edge punctuation and a lone ASCII letter', async () => {
    const { body } = await search({ q: '(helm), z' }, admin.token);
    deepStrictEqual(body.results, [
      { collection: 'SearchItems', UUID: helm, label: 'Helm of Ashbringer' },
    ]);
  });

  it('answers nothing for a blank query', async () => {
    deepStrictEqual((await search({ q: '   ' }, admin.token)).body, { results: [] });
    deepStrictEqual((await search({ q: 'a .' }, admin.token)).body, { results: [] });
  });

  it('caps the records per collection at `limit`', async () => {
    const { body } = await search({ q: 'ashbringer', limit: 1 }, admin.token);
    deepStrictEqual(body.results.map((result) => result.collection).toSorted(), [
      'SearchItems',
      'SearchNotes',
    ]);
  });

  it('pages through one collection with `collection` and `offset`, each match once', async () => {
    const page = async (offset: number) =>
      (await search({ q: 'ashbringer', collection: 'SearchItems', limit: 1, offset }, admin.token))
        .body.results;
    const pages = [await page(0), await page(1), await page(2)];
    ok(pages.every((results) => results.length === 1));
    deepStrictEqual(
      pages
        .flat()
        .map((result) => result.UUID)
        .toSorted(),
      [blade, helm, lore].toSorted(),
    );
    deepStrictEqual(await page(3), []);
    deepStrictEqual(
      (await search({ q: 'ashbringer', collection: 'Nowhere' }, admin.token)).body.results,
      [],
    );
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

  it('finds a token in the text of a nested block', async () => {
    const { status, body } = await search({ q: 'throne frozen' }, admin.token);
    strictEqual(status, 200);
    deepStrictEqual(body.results, [{ collection: 'SearchPages', UUID: stacked, label: 'Stacked' }]);
  });

  it('finds a token in a child field', async () => {
    const { body } = await search({ q: 'lordaeron' }, admin.token);
    deepStrictEqual(body.results, [{ collection: 'SearchPages', UUID: summed, label: 'Summed' }]);
  });

  it('never searches a relation target', async () => {
    const { body } = await search({ q: 'corrupted' }, admin.token);
    deepStrictEqual(
      body.results.map((result) => result.collection),
      ['SearchItems'],
    );
  });

  it('drops the fields past the condition budget instead of refusing', async () => {
    const one = await search({ q: '11' }, admin.token);
    deepStrictEqual(one.body.results, [{ collection: 'SearchWide', UUID: wide, label: 'wide 1' }]);
    const phrases = Array.from({ length: 9 }, (_, at) => `"wide ${at + 1}"`);
    const ten = await search({ q: `11 ${phrases.join(' ')}` }, admin.token);
    strictEqual(ten.status, 200);
    deepStrictEqual(ten.body.results, []);
  });

  it('finds the record a pasted `UUID` names, in any letter case', async () => {
    deepStrictEqual(await found(blade), [
      { collection: 'SearchItems', UUID: blade, label: 'Ashbringer' },
    ]);
    deepStrictEqual(await found(blade.toUpperCase()), await found(blade));
  });

  it('finds the owner of an object item or a nested block item by its `UUID`', async () => {
    deepStrictEqual(await found(summedItem), [
      { collection: 'SearchPages', UUID: summed, label: 'Summed' },
    ]);
    deepStrictEqual(await found(heroItem), [
      { collection: 'SearchPages', UUID: stacked, label: 'Stacked' },
    ]);
    deepStrictEqual(await found(stackItem.UUID), [
      { collection: 'SearchPages', UUID: stacked, label: 'Stacked' },
    ]);
  });

  it('never matches a `UUID` inside text', async () => {
    deepStrictEqual(await found(STORED_UUID), []);
    deepStrictEqual(
      (await found(admin.uuid)).map((result) => result.collection),
      ['Users'],
    );
  });

  it('matches a select by its choice label, a date by its ISO prefix, an opted-in integer', async () => {
    const paint = { collection: 'SearchTasks', UUID: inProgress, label: 'Paint the hall' };
    deepStrictEqual(await found('progress'), [paint]);
    deepStrictEqual(await found('done'), [
      { collection: 'SearchTasks', UUID: finished, label: 'Sweep the yard' },
    ]);
    deepStrictEqual(await found('2026-03'), [paint]);
    deepStrictEqual(await found('2026-03-14'), [paint]);
    deepStrictEqual(await found('42'), [paint]);
  });

  it('never matches a field with `search: false`, nor inside a composite with it', async () => {
    deepStrictEqual(await found('classified'), []);
    deepStrictEqual(await found('buried'), []);
  });

  it('keeps `dashboard.search: false` out of word search, never out of identity', async () => {
    deepStrictEqual(await found('grove'), [
      { collection: 'SearchTags', UUID: tag, label: 'Grove tag' },
    ]);
    deepStrictEqual(await found(secret), [
      { collection: 'SearchSecrets', UUID: secret, label: 'Hidden grove' },
    ]);
  });

  it('finds a singleton and an unlabeled collection by a `UUID` alone', async () => {
    deepStrictEqual(await found('forever'), []);
    deepStrictEqual(await found(settings), [
      { collection: 'SearchSettings', UUID: settings, label: 'Grove forever' },
    ]);
    deepStrictEqual(await found(unlabeled), [
      { collection: 'SearchUnlabeled', UUID: unlabeled, label: '' },
    ]);
  });

  it('skips a read that throws an `HTTPError`, keeping every other hit', async () => {
    const { status, body } = await search({ q: 'wyrmrest' }, admin.token);
    strictEqual(status, 200);
    deepStrictEqual(body.results, [
      { collection: 'SearchKeeps', UUID: keep, label: 'Wyrmrest keep' },
      { collection: 'SearchTripwires', UUID: trip, label: 'Wyrmrest tripwire' },
    ]);
  });

  it('fails loudly on a hook answering an operator its field refuses', async () => {
    printed.length = 0;
    strictEqual((await search({ q: 'loose' }, admin.token)).status, 500);
    ok(/Search hook of .*searchLoose.* answers .*isNull/.test(printed.join('')));
  });

  it('stops reading once the signal aborts, answering what it found', async () => {
    deepStrictEqual(await searchUnder('wyrmrest', AbortSignal.abort()), []);
    const gone = await search({ q: 'wyrmrest' }, admin.token, ROUTE, AbortSignal.abort());
    deepStrictEqual(gone, { status: 200, body: { results: [] } });
    tripwire = new AbortController();
    try {
      deepStrictEqual(await searchUnder('wyrmrest', tripwire.signal), [
        { collection: 'SearchKeeps', UUID: keep, label: 'Wyrmrest keep' },
      ]);
    } finally {
      tripwire = null;
    }
  });

  it("reads a translatable collection in the user's content language", async () => {
    const german = { collection: 'SearchDocs', UUID: harbor, label: 'Hafen' };
    deepStrictEqual(await found('hafen', germanUser.token), [german]);
    deepStrictEqual(await found('hafen'), []);
    deepStrictEqual(await found('harbor'), [{ ...german, label: 'Harbor' }]);
    deepStrictEqual(await found('corrupted', germanUser.token), [
      { collection: 'SearchItems', UUID: blade, label: 'Ashbringer' },
    ]);
  });

  it('leads with records whose own label values hold every word, not their rendered template', async () => {
    deepStrictEqual(await found('invoice'), [
      { collection: 'SearchLedgers', UUID: ledger, label: 'Invoice ledger' },
      { collection: 'SearchInvoices', UUID: invoice, label: 'Invoice A-17' },
    ]);
  });

  it('caps `limit` at 50 records per collection', async () => {
    strictEqual((await search({ q: 'bulk', limit: 80 }, admin.token)).body.results.length, 50);
  });

  it('refuses a guest, an unknown key, a non-string `q`, and a bad `limit`, `offset` or `collection`', async () => {
    strictEqual((await search({ q: 'ashbringer' }, null)).status, 401);
    strictEqual((await search({ q: 'a', page: 1 }, admin.token)).status, 400);
    strictEqual((await search({ q: 1 }, admin.token)).status, 400);
    strictEqual((await search({}, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', limit: 0 }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', limit: 1.5 }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', offset: -1 }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', collection: 1 }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', limit: '5' }, admin.token)).status, 400);
    strictEqual((await search({ q: 'a', offset: '1' }, admin.token)).status, 400);
  });
});
