import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../src/base/auth/types.ts';
import type {
  DashboardCollection,
  DashboardField,
} from '../../../src/base/collections-api/describe.ts';
import type { FieldTypeName } from '../../../src/ohne/fields/known-fields.ts';
import type { HTTPMethod } from '../../../src/utils/index.ts';

import { describeCollections, firstTextField } from '../../../src/base/collections-api/describe.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field, type FieldInstance } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { routeID } from '../../../src/ohne/routes/route.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';

usePrinter().configure({ stream: { write: () => true } });

useRoles().register('desc-editor', {
  name: 'desc-editor',
  role: { capabilities: ['collection.DescNotes.*', 'collection.DescOwners.read'] },
});

useCollections().register('DescNotes', {
  name: 'DescNotes',
  collection: {
    api: { read: true, create: true, update: { access: () => true }, delete: true },
    fields: {
      title: field('text'),
      note: field('text', { nullable: true, when: { title: { startsWith: 'Draft' } } }),
      owner: field('record', { collection: 'DescOwners' }),
      steps: field('repeater', {
        fields: { tip: field('text', { nullable: true, when: { '../owner': { has: true } } }) },
      }),
    },
  },
});
useCollections().register('DescOwners', {
  name: 'DescOwners',
  collection: {
    label: 'desc.owners.label',
    api: { read: true, update: true },
    dashboard: {
      table: { order: ['-name', 'UUID'] },
      layout: [{ card: ['name | 50%', 'ghost'] }],
    },
    fields: { name: field('text') },
  },
});
useFields().register('descSpan', {
  name: 'descSpan' as FieldTypeName,
  fieldType: defineField({
    columnType: false,
    schema: () => ({
      kind: 'child',
      cardinality: 'one',
      subfields: { start: field('date'), end: field('date') },
      orderBy: 'start',
    }),
  }),
});
useCollections().register('DescPublic', {
  name: 'DescPublic',
  collection: {
    api: { read: 'public', delete: 'public' },
    fields: {
      title: field('text'),
      stage: field('select', { choices: ['open', 'shut'], default: 'open' }),
      stamp: field('text', { default: () => 'now' }),
      span: { type: 'descSpan', options: {} } as unknown as FieldInstance,
      place: field('object', { fields: { city: field('text') } }),
    },
  },
});
useFields().register('descSecret', {
  name: 'descSecret' as FieldTypeName,
  fieldType: defineField({ columnType: 'text', copy: false }),
});
useCollections().register('DescSlugs', {
  name: 'DescSlugs',
  collection: { api: { read: 'public' }, fields: { slug: field('text', { unique: true }) } },
});
useCollections().register('DescShapedSlugs', {
  name: 'DescShapedSlugs',
  collection: {
    api: { read: 'public' },
    fields: { slug: field('text', { unique: true }) },
    duplicate: ({ input, source }) => ({ ...input, slug: `${source.slug as string}-copy` }),
  },
});
useCollections().register('DescOptionalSlugs', {
  name: 'DescOptionalSlugs',
  collection: {
    api: { read: 'public' },
    fields: { slug: field('text', { unique: true, nullable: true }) },
  },
});
useCollections().register('DescSecrets', {
  name: 'DescSecrets',
  collection: {
    api: { read: 'public' },
    fields: { secret: { type: 'descSecret', options: {} } as unknown as FieldInstance },
  },
});
useCollections().register('DescFiles', {
  name: 'DescFiles',
  collection: {
    api: { read: 'public' },
    duplicate: false,
    fields: { title: field('text', { nullable: true }) },
  },
});
useCollections().register('DescClosed', {
  name: 'DescClosed',
  collection: { fields: { title: field('text') } },
});

function serve(method: HTTPMethod, pattern: string): void {
  useRoutes().register(routeID(method, pattern), {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: () => null,
  });
}

serve('POST', '/collections/[collection]/query');
serve('POST', '/collections/[collection]');
serve('PATCH', '/collections/[collection]/[uuid]');
serve('DELETE', '/collections/desc-notes/[uuid]');

function userWith(roles: string[]): User {
  return {
    UUID: 'u',
    email: 'u@example.com',
    firstName: null,
    lastName: null,
    roles,
    dashboardLanguage: null,
    contentLanguage: null,
    timezone: null,
    dateFormat: 'LL',
    timeFormat: 'LTS',
    smartClipboard: false,
  };
}

const DUPLICABLES = [
  'DescSlugs',
  'DescShapedSlugs',
  'DescOptionalSlugs',
  'DescSecrets',
  'DescFiles',
];

const editor = userWith(['desc-editor']);
const guest = userWith([]);

function collectionOf(user: User, name: string): DashboardCollection {
  const found = describeCollections(user).find((collection) => collection.name === name);
  if (!found) throw new Error(`collection ${name} missing from the description`);
  return found;
}

describe('describeCollections', () => {
  it('lists the collections the user may work with, in registry order', () => {
    deepStrictEqual(
      describeCollections(editor).map((collection) => collection.name),
      ['DescNotes', 'DescOwners', 'DescPublic', ...DUPLICABLES],
    );
    deepStrictEqual(
      describeCollections(guest).map((collection) => collection.name),
      ['DescPublic', ...DUPLICABLES],
    );
  });

  it('carries each operation verdict, null where unexposed, scoped where an access resolver is declared', () => {
    deepStrictEqual(collectionOf(editor, 'DescNotes').operations, {
      read: { allowed: true, public: false, scoped: false },
      create: { allowed: true, public: false, scoped: false },
      update: { allowed: true, public: false, scoped: true },
      delete: { allowed: true, public: false, scoped: false },
    });
    deepStrictEqual(collectionOf(editor, 'DescOwners').operations, {
      read: { allowed: true, public: false, scoped: false },
      create: null,
      update: { allowed: false, public: false, scoped: false },
      delete: null,
    });
  });

  it('closes an operation whose route the app does not serve, counting a route the app declares itself', () => {
    strictEqual(collectionOf(guest, 'DescPublic').operations.delete, null);
    deepStrictEqual(collectionOf(editor, 'DescNotes').operations.delete, {
      allowed: true,
      public: false,
      scoped: false,
    });
  });

  it('names the segment, the label, the fields with the system entries first, and the label fields', () => {
    const notes = collectionOf(editor, 'DescNotes');
    strictEqual(notes.segment, 'desc-notes');
    strictEqual(notes.label, 'Desc notes');
    strictEqual(notes.translatable, false);
    strictEqual(notes.singleton, false);
    deepStrictEqual(
      notes.fields.map((entry) => entry.name),
      ['UUID', '_updatedAt', 'title', 'note', 'owner', 'steps'],
    );
    deepStrictEqual(notes.labelFields, ['title']);
  });

  it('ships a declared label as its message, for the dashboard to translate', () => {
    strictEqual(collectionOf(editor, 'DescOwners').label, 'desc.owners.label');
  });

  it('ships the declared default sort unchanged', () => {
    deepStrictEqual(collectionOf(editor, 'DescOwners').table?.order, ['-name', 'UUID']);
  });

  it('offers a duplicate only where a copy can succeed without input', () => {
    strictEqual(collectionOf(editor, 'DescNotes').duplicable, true);
    strictEqual(collectionOf(guest, 'DescSlugs').duplicable, false);
    strictEqual(collectionOf(guest, 'DescShapedSlugs').duplicable, true);
    strictEqual(collectionOf(guest, 'DescOptionalSlugs').duplicable, true);
    strictEqual(collectionOf(guest, 'DescSecrets').duplicable, false);
    strictEqual(collectionOf(guest, 'DescFiles').duplicable, false);
  });

  it('ships a `when` gate in its condition object form, and none on an ungated field', () => {
    const fields = collectionOf(editor, 'DescNotes').fields;
    const named = (name: string) => fields.find((entry) => entry.name === name);
    deepStrictEqual(named('note')?.when, { title: { startsWith: 'Draft' } });
    strictEqual('when' in (named('title') ?? {}), false);
    const tip = named('steps')?.subfields?.find((entry) => entry.name === 'tip');
    deepStrictEqual(tip?.when, { '../owner': { has: true } });
  });

  it('ships a static default for the editor to seed, and never a computed one', () => {
    const fields = collectionOf(guest, 'DescPublic').fields;
    const named = (name: string) => fields.find((entry) => entry.name === name);
    strictEqual(named('stage')?.options?.default, 'open');
    strictEqual('default' in (named('stamp')?.options ?? {}), false);
  });

  it('names each subfield type and the sort key a composite type fixes', () => {
    const fields = collectionOf(guest, 'DescPublic').fields;
    const named = (name: string) => fields.find((entry) => entry.name === name);
    deepStrictEqual(
      named('span')?.subfields?.map(({ name, type }) => [name, type]),
      [
        ['UUID', null],
        ['start', 'date'],
        ['end', 'date'],
      ],
    );
    strictEqual(named('span')?.type, 'descSpan');
    strictEqual(named('span')?.orderBy, 'start');
    strictEqual('orderBy' in (named('place') ?? {}), false);
    strictEqual(named('place')?.subfields?.find((entry) => entry.name === 'city')?.type, 'text');
  });

  it('resolves a declared layout against the described fields, dropping a name it lacks', () => {
    deepStrictEqual(collectionOf(editor, 'DescOwners').layout, [
      { kind: 'card', collapsible: false, nodes: [{ kind: 'field', name: 'name', width: '50%' }] },
    ]);
    strictEqual(collectionOf(editor, 'DescNotes').layout, undefined);
  });
});

describe('firstTextField', () => {
  const column = (name: string, type: string, readable = true): DashboardField =>
    ({ name, type, kind: 'column', logicalType: 'text', readable }) as DashboardField;

  it('names a block by its first readable text field, past every choice', () => {
    const fields = [
      column('layout', 'select'),
      column('country', 'country'),
      column('heading', 'text'),
    ];
    strictEqual(firstTextField(fields), 'heading');
    strictEqual(
      firstTextField([column('secret', 'text', false), column('title', 'text')]),
      'title',
    );
  });

  it('names nothing when a block has only choices', () => {
    strictEqual(firstTextField([column('ratio', 'select'), column('email', 'email')]), undefined);
  });
});
