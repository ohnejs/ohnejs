import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import dashboardGet, {
  type DashboardBlock,
  type DashboardCollection,
  type DashboardMeta,
} from '../../../src/layer/api/dashboard.get.ts';
import { hashSessionToken } from '../../../src/layer/auth/_token.ts';
import SessionsCollection from '../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../src/layer/collections/Users.ts';
import passwordField from '../../../src/layer/fields/password.ts';
import rolesField from '../../../src/layer/fields/roles.ts';
import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { keyBy } from '../../../src/utils/index.ts';

declare module 'ohne' {
  interface KnownMessages {
    'dashMenu.tools': { n: number };
  }
}

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({
  path: '/dashboard-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
    dashboard: {
      menu: [
        {
          label: 'Content',
          items: [
            'DashNotes',
            { to: '/reports', label: 'dash.menu.reports', icon: 'chart-bar' },
            'DashClosed',
          ],
        },
        {
          label: { key: 'dashMenu.tools', params: { n: 2 } },
          items: [{ to: '/tools', label: 'Tools' }],
        },
      ],
    },
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
  'dash.kinds.title.placeholder': 'Short name',
  'dash.blocks.hero.label': 'Hero section',
  'dash.menu.reports': 'Reports',
  'dashMenu.tools': '{n, plural, one {# tool} other {# tools}}',
});

useCollections().register('DashNotes', {
  name: 'DashNotes',
  collection: {
    api: { read: true, create: true, update: true, delete: true },
    dashboard: {
      recordLabel: ['title', 'note'],
      table: { columns: ['title | 20rem', 'note'] },
    },
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
  collection: {
    api: { read: 'public' },
    dashboard: { recordLabel: 'title' },
    fields: { title: field('text') },
  },
});
useCollections().register('DashPeople', {
  name: 'DashPeople',
  collection: {
    api: { read: 'public' },
    dashboard: { recordLabel: '{lastName}, {firstName}' },
    fields: { firstName: field('text'), lastName: field('text') },
  },
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

useBlocks().register('DashHero', {
  name: 'DashHero',
  block: {
    label: 'dash.blocks.hero.label',
    fields: {
      heading: field('text'),
      nested: field('blocks', { allow: ['DashAside'] }),
    },
  },
});
useBlocks().register('DashAside', {
  name: 'DashAside',
  block: { fields: { words: field('text') } },
});
useBlocks().register('DashSecret', {
  name: 'DashSecret',
  block: { fields: { code: field('text') } },
});

useCollections().register('DashPages', {
  name: 'DashPages',
  collection: {
    api: { read: 'public' },
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['DashHero'] }),
    },
  },
});
useCollections().register('DashVault', {
  name: 'DashVault',
  collection: { fields: { body: field('blocks', { allow: ['DashSecret'] }) } },
});
useCollections().register('DashMetrics', {
  name: 'DashMetrics',
  collection: {
    api: { read: 'public' },
    fields: { views: field('integer'), secret: field('text', { readable: false, nullable: true }) },
  },
});

useCollections().register('DashKinds', {
  name: 'DashKinds',
  collection: {
    api: { read: 'public' },
    fields: {
      title: field('text', { placeholder: 'dash.kinds.title.placeholder', max: 40 }),
      status: field('select', { choices: ['draft', { value: 'live', label: 'Published' }] }),
      tags: field('multiSelect', { choices: ['a', 'b'], max: 2 }),
      day: field('date', { min: '2024-01-01', nullable: true }),
      flag: field('boolean', { display: 'switch' }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
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

function menuPaths(body: DashboardMeta): { label: string; items: string[] }[] {
  return body.menu.map((group) => ({
    label: group.label,
    items: group.items.map((item) => item.to),
  }));
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
      'DashPeople',
      'DashArticles',
      'DashLabels',
      'DashPages',
      'DashMetrics',
      'DashKinds',
    ]);
  });

  it('widens with capabilities: admin sees every exposed collection', async () => {
    deepStrictEqual(names((await call(admin)).body), [
      'Users',
      'Sessions',
      'DashNotes',
      'DashOwners',
      'DashPublic',
      'DashPeople',
      'DashDenied',
      'DashArticles',
      'DashLabels',
      'DashPages',
      'DashMetrics',
      'DashKinds',
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

describe('table', () => {
  it('ships the declared list-view defaults verbatim and omits the key elsewhere', async () => {
    const { body } = await call(admin);
    deepStrictEqual(collection(body, 'DashNotes').table, { columns: ['title | 20rem', 'note'] });
    strictEqual('table' in collection(body, 'DashPublic'), false);
  });

  it('ships the layer collections with their default icons', async () => {
    const { body } = await call(admin);
    strictEqual(collection(body, 'Users').icon, 'users');
    strictEqual(collection(body, 'Sessions').icon, 'key');
  });
});

describe('labelFields', () => {
  it('ships the declared recordLabel as a list', async () => {
    const { body } = await call(user);
    deepStrictEqual(collection(body, 'DashNotes').labelFields, ['title', 'note']);
    deepStrictEqual(collection(body, 'DashPublic').labelFields, ['title']);
  });

  it('ships a template recordLabel as its tokens plus the template', async () => {
    const { body } = await call(user);
    const people = collection(body, 'DashPeople');
    deepStrictEqual(people.labelFields, ['lastName', 'firstName']);
    strictEqual(people.labelTemplate, '{lastName}, {firstName}');
    strictEqual('labelTemplate' in collection(body, 'DashNotes'), false);
  });

  it('derives the first readable plain text field when none is declared', async () => {
    const { body } = await call(user);
    deepStrictEqual(collection(body, 'DashOwners').labelFields, ['name']);
  });

  it('is empty when no field can label a record', async () => {
    const { body } = await call(user);
    deepStrictEqual(collection(body, 'DashMetrics').labelFields, []);
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
    strictEqual(fields.title?.logicalType, 'text');
    strictEqual(fields.owner?.logicalType, 'text');
    strictEqual(fields.title?.options?.allowEmpty, false);
    strictEqual(fields.owner?.kind, 'record');
    strictEqual(fields.owner?.target, 'DashOwners');
    strictEqual(fields.secret?.readable, false);
    const owners = keyBy(collection(body, 'DashOwners').fields, (entry) => entry.name);
    strictEqual(owners.name?.unique, true);
  });

  it('ships the declared options as plain data, structural ones stripped', async () => {
    const { body } = await call(user);
    const kinds = keyBy(collection(body, 'DashKinds').fields, (entry) => entry.name);
    deepStrictEqual(kinds.status?.options, {
      choices: ['draft', { value: 'live', label: 'Published' }],
    });
    deepStrictEqual(kinds.tags?.options, { choices: ['a', 'b'], max: 2 });
    deepStrictEqual(kinds.day?.options, { min: '2024-01-01' });
    deepStrictEqual(kinds.flag?.options, { display: 'switch' });
    deepStrictEqual(kinds.title?.options, { allowEmpty: false, max: 40, multiline: false });
    const notes = keyBy(collection(body, 'DashNotes').fields, (entry) => entry.name);
    strictEqual(notes.owner?.options, undefined);
    const owners = keyBy(collection(body, 'DashOwners').fields, (entry) => entry.name);
    strictEqual(owners.profile?.options, undefined);
  });

  it('resolves a declared placeholder in the request language', async () => {
    const { body } = await call(user);
    const kinds = keyBy(collection(body, 'DashKinds').fields, (entry) => entry.name);
    strictEqual(kinds.title?.placeholder, 'Short name');
    strictEqual(kinds.status?.placeholder, undefined);
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
    deepStrictEqual(menuPaths((await call(user)).body), [
      { label: 'Content', items: ['/collections/dash-notes', '/reports'] },
      { label: '2 tools', items: ['/tools'] },
      {
        label: '',
        items: [
          '/collections/sessions',
          '/collections/dash-owners',
          '/collections/dash-public',
          '/collections/dash-people',
          '/collections/dash-articles',
          '/collections/dash-labels',
          '/collections/dash-pages',
          '/collections/dash-metrics',
          '/collections/dash-kinds',
        ],
      },
    ]);
  });

  it('scopes the groups per user', async () => {
    deepStrictEqual(menuPaths((await call(admin)).body), [
      { label: 'Content', items: ['/collections/dash-notes', '/reports'] },
      { label: '2 tools', items: ['/tools'] },
      {
        label: '',
        items: [
          '/collections/users',
          '/collections/sessions',
          '/collections/dash-owners',
          '/collections/dash-public',
          '/collections/dash-people',
          '/collections/dash-denied',
          '/collections/dash-articles',
          '/collections/dash-labels',
          '/collections/dash-pages',
          '/collections/dash-metrics',
          '/collections/dash-kinds',
        ],
      },
    ]);
  });

  it('resolves a collection row to its list route, sentence-cased label, and declared icon', async () => {
    const { menu } = (await call(admin)).body;
    deepStrictEqual(menu[0]?.items[0], { to: '/collections/dash-notes', label: 'Dash notes' });
    deepStrictEqual(menu[2]?.items[0], {
      to: '/collections/users',
      label: 'Users',
      icon: 'users',
    });
  });

  it('resolves a declared link as authored, its label in the request language', async () => {
    const { menu } = (await call(user)).body;
    deepStrictEqual(menu[0]?.items[1], { to: '/reports', label: 'Reports', icon: 'chart-bar' });
    deepStrictEqual(menu[1], { label: '2 tools', items: [{ to: '/tools', label: 'Tools' }] });
  });
});

describe('the dashboard:menu hook', () => {
  it('filters the resolved menu, carrying the user and the accessible collections', async () => {
    let seen: string[] = [];
    hook('dashboard:menu', (menu, context) => {
      seen = context.collections.map((entry) => entry.name);
      return [...menu, { label: context.user.email, items: [{ to: '/audit', label: 'Audit' }] }];
    });
    try {
      const { menu } = (await call(user)).body;
      deepStrictEqual(menu.at(-1), {
        label: 'user@example.com',
        items: [{ to: '/audit', label: 'Audit' }],
      });
      deepStrictEqual(seen, names((await call(user)).body));
    } finally {
      useHooks().delete('dashboard:menu');
    }
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

describe('blocks', () => {
  function block(body: DashboardMeta, name: string): DashboardBlock {
    const found = body.blocks.find((entry) => entry.name === name);
    if (!found) throw new Error(`block ${name} missing from the response`);
    return found;
  }

  it('serves the types the visible collections reach, sorted, and nothing else', async () => {
    deepStrictEqual(
      (await call(user)).body.blocks.map((entry) => entry.name),
      ['DashAside', 'DashHero'],
    );
  });

  it('resolves a declared label and sentence-cases an omitted one', async () => {
    const { body } = await call(user);
    strictEqual(block(body, 'DashHero').label, 'Hero section');
    strictEqual(block(body, 'DashAside').label, 'Dash aside');
  });

  it("describes a block's own fields, led by `UUID` and without `_updatedAt`", async () => {
    const fields = block((await call(user)).body, 'DashHero').fields;
    deepStrictEqual(
      fields.map((entry) => entry.name),
      ['UUID', 'heading', 'nested'],
    );
    strictEqual(fields[1]?.type, 'text');
    strictEqual(fields[1]?.required, true);
  });

  it('resolves `allow` on a field and on a block subfield alike', async () => {
    const { body } = await call(user);
    const content = keyBy(collection(body, 'DashPages').fields, (entry) => entry.name).content;
    strictEqual(content?.kind, 'blocks');
    deepStrictEqual(content?.allow, ['DashHero']);
    const nested = keyBy(block(body, 'DashHero').fields, (entry) => entry.name).nested;
    strictEqual(nested?.kind, 'blocks');
    deepStrictEqual(nested?.allow, ['DashAside']);
  });
});
