import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../src/base/auth/types.ts';
import type { DashboardCollection } from '../../../src/base/collections-api/describe.ts';
import type { HTTPMethod } from '../../../src/utils/index.ts';

import { describeCollections } from '../../../src/base/collections-api/describe.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../src/ohne/fields/field.ts';
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
    api: { read: true, update: true },
    dashboard: { layout: [{ card: ['name | 50%', 'ghost'] }] },
    fields: { name: field('text') },
  },
});
useCollections().register('DescPublic', {
  name: 'DescPublic',
  collection: {
    api: { read: 'public', delete: 'public' },
    fields: { title: field('text') },
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
      ['DescNotes', 'DescOwners', 'DescPublic'],
    );
    deepStrictEqual(
      describeCollections(guest).map((collection) => collection.name),
      ['DescPublic'],
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

  it('ships a `when` gate in its condition object form, and none on an ungated field', () => {
    const fields = collectionOf(editor, 'DescNotes').fields;
    const named = (name: string) => fields.find((entry) => entry.name === name);
    deepStrictEqual(named('note')?.when, { title: { startsWith: 'Draft' } });
    strictEqual('when' in (named('title') ?? {}), false);
    const tip = named('steps')?.subfields?.find((entry) => entry.name === 'tip');
    deepStrictEqual(tip?.when, { '../owner': { has: true } });
  });

  it('resolves a declared layout against the described fields, dropping a name it lacks', () => {
    deepStrictEqual(collectionOf(editor, 'DescOwners').layout, [
      { kind: 'card', collapsible: false, nodes: [{ kind: 'field', name: 'name', width: '50%' }] },
    ]);
    strictEqual(collectionOf(editor, 'DescNotes').layout, undefined);
  });
});
