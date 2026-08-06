import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import dashboardGet, {
  type DashboardCollection,
  type DashboardMeta,
} from '../../../src/layer/api/dashboard.get.ts';
import { hashSessionToken } from '../../../src/layer/auth/_token.ts';
import SessionsCollection from '../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../src/layer/collections/Users.ts';
import passwordField from '../../../src/layer/fields/password.ts';
import rolesField from '../../../src/layer/fields/roles.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { keyBy } from '../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/dashboard-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
    dashboard: { menu: [{ label: 'Content', collections: ['DashNotes', 'DashClosed'] }] },
  },
});

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('dash-user', {
  name: 'dash-user',
  role: { capabilities: ['collection.DashNotes.*', 'collection.DashOwners.read'] },
});

useMessages().register('en', {
  'dashboard.fields.uuid.label': 'UUID',
  'dashboard.fields.updatedAt.label': 'Updated',
  'dash.owners.name.label': 'Owner name',
});

useCollections().register('DashNotes', {
  name: 'DashNotes',
  collection: {
    api: { read: true, create: true, update: true, delete: true },
    fields: {
      title: field('text'),
      note: field('text', { nullable: true }),
      owner: field('record', { collection: 'DashOwners' }),
      secret: field('text', { readable: false, nullable: true }),
    },
  },
});
useCollections().register('DashOwners', {
  name: 'DashOwners',
  collection: {
    api: { read: true },
    fields: {
      name: field('text', { unique: true, label: 'dash.owners.name.label' }),
      profile: field('object', { fields: { bio: field('text', { nullable: true }) } }),
    },
  },
});
useCollections().register('DashPublic', {
  name: 'DashPublic',
  collection: { api: { read: 'public' }, fields: { title: field('text') } },
});
useCollections().register('DashClosed', {
  name: 'DashClosed',
  collection: { fields: { title: field('text') } },
});
useCollections().register('DashDenied', {
  name: 'DashDenied',
  collection: { api: { read: true }, fields: { title: field('text') } },
});
useCollections().register('DashArticles', {
  name: 'DashArticles',
  collection: {
    api: { read: 'public' },
    fields: {
      title: field('text'),
      tags: field('records', { collection: 'DashLabels', translatable: true }),
    },
  },
});
useCollections().register('DashLabels', {
  name: 'DashLabels',
  collection: {
    api: { read: 'public' },
    fields: {
      name: field('text', { translatable: true }),
      articles: field('records', { collection: 'DashArticles', inverse: 'tags' }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<string> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

const user = await userWith('user@example.com', ['dash-user']);
const admin = await userWith('admin@example.com', ['admin']);

const route: Route = {
  method: 'GET',
  pattern: '/dashboard',
  file: 'dashboard.get.ts',
  layer: 'ohne',
  handler: dashboardGet as AnyHandler,
};

async function call(bearer: string | null): Promise<{ status: number; body: DashboardMeta }> {
  const url = 'http://x.test/dashboard';
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const request = new Request(url, { headers });
  const { response } = await dispatch(route, request, new URL(url), {});
  return { status: response.status, body: (await response.json()) as DashboardMeta };
}

function names(body: DashboardMeta): string[] {
  return body.collections.map((collection) => collection.name);
}

function collection(body: DashboardMeta, name: string): DashboardCollection {
  const found = body.collections.find((entry) => entry.name === name);
  if (!found) throw new Error(`collection ${name} missing from the response`);
  return found;
}

describe('access', () => {
  it('401s an anonymous request', async () => {
    strictEqual((await call(null)).status, 401);
  });

  it('lists only the collections the user may work with', async () => {
    const { status, body } = await call(user);
    strictEqual(status, 200);
    deepStrictEqual(names(body), [
      'Sessions',
      'DashNotes',
      'DashOwners',
      'DashPublic',
      'DashArticles',
      'DashLabels',
    ]);
  });

  it('widens with capabilities: admin sees every exposed collection', async () => {
    deepStrictEqual(names((await call(admin)).body), [
      'Users',
      'Sessions',
      'DashNotes',
      'DashOwners',
      'DashPublic',
      'DashDenied',
      'DashArticles',
      'DashLabels',
    ]);
  });
});

describe('operations', () => {
  it('carries the per-operation verdicts', async () => {
    const { body } = await call(user);
    deepStrictEqual(collection(body, 'DashNotes').operations, {
      read: { allowed: true, public: false },
      create: { allowed: true, public: false },
      update: { allowed: true, public: false },
      delete: { allowed: true, public: false },
    });
    deepStrictEqual(collection(body, 'DashOwners').operations, {
      read: { allowed: true, public: false },
      create: null,
      update: null,
      delete: null,
    });
    deepStrictEqual(collection(body, 'DashPublic').operations, {
      read: { allowed: true, public: true },
      create: null,
      update: null,
      delete: null,
    });
  });

  it('names the URL segment in kebab-case', async () => {
    const { body } = await call(user);
    strictEqual(collection(body, 'DashNotes').segment, 'dash-notes');
  });
});

describe('fields', () => {
  it('describes fields in declaration order, system fields first', async () => {
    const { body } = await call(user);
    deepStrictEqual(
      collection(body, 'DashNotes').fields.map((entry) => entry.name),
      ['UUID', '_updatedAt', 'title', 'note', 'owner', 'secret'],
    );
  });

  it('marks the system fields unwritable and labels them from the catalog', async () => {
    const { body } = await call(user);
    const fields = keyBy(collection(body, 'DashNotes').fields, (entry) => entry.name);
    strictEqual(fields.UUID?.type, null);
    strictEqual(fields.UUID?.label, 'UUID');
    strictEqual(fields.UUID?.writable, false);
    strictEqual(fields._updatedAt?.label, 'Updated');
    strictEqual(fields._updatedAt?.writable, false);
  });

  it('derives required from nullability and defaults', async () => {
    const { body } = await call(user);
    const fields = keyBy(collection(body, 'DashNotes').fields, (entry) => entry.name);
    strictEqual(fields.title?.required, true);
    strictEqual(fields.note?.required, false);
    strictEqual(fields.owner?.required, false);
  });

  it('resolves labels: declared keys through the catalog, omitted to the sentence-cased name', async () => {
    const { body } = await call(user);
    const notes = keyBy(collection(body, 'DashNotes').fields, (entry) => entry.name);
    const owners = keyBy(collection(body, 'DashOwners').fields, (entry) => entry.name);
    strictEqual(notes.title?.label, 'Title');
    strictEqual(owners.name?.label, 'Owner name');
  });

  it('carries type, kind, flags, and relation targets', async () => {
    const { body } = await call(user);
    const fields = keyBy(collection(body, 'DashNotes').fields, (entry) => entry.name);
    strictEqual(fields.title?.type, 'text');
    strictEqual(fields.title?.kind, 'column');
    strictEqual(fields.title?.allowEmpty, false);
    strictEqual(fields.owner?.kind, 'record');
    strictEqual(fields.owner?.target, 'DashOwners');
    strictEqual(fields.secret?.readable, false);
    const owners = keyBy(collection(body, 'DashOwners').fields, (entry) => entry.name);
    strictEqual(owners.name?.unique, true);
  });

  it('describes composite subfields, the item UUID included', async () => {
    const { body } = await call(user);
    const owners = keyBy(collection(body, 'DashOwners').fields, (entry) => entry.name);
    strictEqual(owners.profile?.kind, 'childOne');
    deepStrictEqual(
      owners.profile?.subfields?.map((entry) => entry.name),
      ['UUID', 'bio'],
    );
    strictEqual(owners.profile?.subfields?.[1]?.type, 'text');
  });
});

describe('menu', () => {
  it('folds the configured groups over the accessible collections, the rest trailing', async () => {
    deepStrictEqual((await call(user)).body.menu, [
      { label: 'Content', collections: ['DashNotes'] },
      {
        label: '',
        collections: ['Sessions', 'DashOwners', 'DashPublic', 'DashArticles', 'DashLabels'],
      },
    ]);
  });

  it('scopes the groups per user', async () => {
    deepStrictEqual((await call(admin)).body.menu, [
      { label: 'Content', collections: ['DashNotes'] },
      {
        label: '',
        collections: [
          'Users',
          'Sessions',
          'DashOwners',
          'DashPublic',
          'DashDenied',
          'DashArticles',
          'DashLabels',
        ],
      },
    ]);
  });
});

describe('translatable', () => {
  it('derives per-locale fields from storage, the inverse records side included', async () => {
    const { body } = await call(user);
    const articles = keyBy(collection(body, 'DashArticles').fields, (entry) => entry.name);
    const labels = keyBy(collection(body, 'DashLabels').fields, (entry) => entry.name);
    strictEqual(articles.title?.translatable, false);
    strictEqual(articles.tags?.translatable, true);
    strictEqual(labels.name?.translatable, true);
    strictEqual(labels.articles?.translatable, true);
  });
});

describe('locales', () => {
  it('carries the content locales and the default', async () => {
    const { body } = await call(user);
    deepStrictEqual(body.locales, ['en', 'de']);
    strictEqual(body.defaultLocale, 'en');
  });
});
