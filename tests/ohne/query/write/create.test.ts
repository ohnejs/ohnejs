import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { RecordCommitted } from '../../../../src/ohne/query/write/committed.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { linksField } from './_links-field.ts';

useCollections().register('CUser', {
  name: 'CUser',
  collection: { fields: { name: field('text') } },
});
useCollections().register('CTag', {
  name: 'CTag',
  collection: { fields: { label: field('text') } },
});
useCollections().register('CPost', {
  name: 'CPost',
  collection: {
    fields: {
      title: field('text', { unique: true }),
      views: field('integer'),
      author: field('record', { collection: 'CUser' }),
      tags: field('records', { collection: 'CTag' }),
      meta: field('object', { fields: { note: field('text', { nullable: true }) } }),
      sections: field('repeater', { fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('CUniq', {
  name: 'CUniq',
  collection: {
    fields: { links: field('repeater', { fields: { slug: field('text', { unique: true }) } }) },
  },
});
useCollections().register('CNest', {
  name: 'CNest',
  collection: {
    fields: {
      sections: field('repeater', {
        fields: { links: field('repeater', { fields: { slug: field('text', { unique: true }) } }) },
      }),
    },
  },
});
useCollections().register('CLinked', {
  name: 'CLinked',
  collection: {
    fields: {
      links: linksField(),
      sections: field('repeater', { fields: { links: linksField() } }),
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
await db.run('INSERT INTO "CUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'u1',
  1,
  'Anduin',
]);
const anduin = '01900000-0000-7000-8000-00000000000a';
const liadrin = '01900000-0000-7000-8000-00000000000b';
const ghost = '01900000-0000-7000-8000-00000000000c';
await db.run('INSERT INTO "CUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  anduin,
  1,
  'Anduin',
]);
await db.run('INSERT INTO "CUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  liadrin,
  1,
  'Liadrin',
]);
await db.run('INSERT INTO "CTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t1', 1, 'A']);
await db.run('INSERT INTO "CTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t2', 1, 'B']);

const base = {
  views: 10,
  author: 'u1',
  tags: ['t1', 't2'],
  meta: { note: 'n' },
  sections: [{ heading: 'a' }, { heading: 'b' }],
};

describe('runCreate', () => {
  it('inserts a full record and returns its read shape', async () => {
    const result = await runCreate('CPost', { ...base, title: 'Hello' }, null);
    ok(result.ok);
    const record = result.record as Record<string, unknown>;
    strictEqual(record.title, 'Hello');
    strictEqual(record.views, 10);
    strictEqual(record.author, 'u1');
    strictEqual(typeof record.UUID, 'string');
    strictEqual(typeof record._updatedAt, 'number');
    deepStrictEqual(record.tags, ['t1', 't2']);
    strictEqual((record.meta as { note: string }).note, 'n');
    const sections = record.sections as { heading: string }[];
    deepStrictEqual(
      sections.map((s) => s.heading),
      ['a', 'b'],
    );
  });

  it('reports a missing required field and writes nothing', async () => {
    const before = await db.query('SELECT "UUID" FROM "CPost"');
    const result = await runCreate('CPost', { ...base }, null);
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.required');
    const after = await db.query('SELECT "UUID" FROM "CPost"');
    strictEqual(after.length, before.length);
  });

  it('rejects a duplicate unique value at the precheck', async () => {
    await runCreate('CPost', { ...base, title: 'Unique' }, null);
    const result = await runCreate('CPost', { ...base, title: 'Unique' }, null);
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.notUnique');
  });

  it('rejects a missing record reference at its field', async () => {
    const result = await runCreate('CPost', { ...base, title: 'Ref1', author: 'ghost' }, null);
    ok(!result.ok);
    strictEqual(result.errors.author, 'validation.invalidReference');
  });

  it('rejects a missing records reference at its indexed path', async () => {
    const result = await runCreate(
      'CPost',
      { ...base, title: 'Ref2', tags: ['t1', 'ghost'] },
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['tags[1]'], 'validation.invalidReference');
  });

  it('creates through the builder and reads the row back', async () => {
    const result = await queryUntyped('CPost').create({ ...base, title: 'ViaBuilder' });
    ok(result.ok);
    strictEqual((result.record as { title: string }).title, 'ViaBuilder');
  });

  it('throws a validationError from createOrThrow on failure', async () => {
    await rejects(
      queryUntyped('CPost').createOrThrow({ ...base }),
      (error) => isValidationError(error) && 'title' in error.errors,
    );
  });

  it('appends junction positions and preserves link order', async () => {
    await runCreate('CPost', { ...base, title: 'Links', tags: ['t2', 't1'] }, null);
    const links = await db.query<{ _targetUUID: string; _parentPosition: number }>(
      'SELECT "_targetUUID","_parentPosition" FROM "CPost_tags" ' +
        'WHERE "_parentUUID" = (SELECT "UUID" FROM "CPost" WHERE "title" = ?) ORDER BY "_parentPosition"',
      ['Links'],
    );
    deepStrictEqual(
      links.map((l) => l._targetUUID),
      ['t2', 't1'],
    );
  });

  it('rejects a table-wide unique child value colliding with an existing row, at its path', async () => {
    const first = await runCreate('CUniq', { links: [{ slug: 'x' }] }, null);
    ok(first.ok);
    const second = await runCreate('CUniq', { links: [{ slug: 'x' }] }, null);
    ok(!second.ok);
    strictEqual(second.errors['links[0].slug'], 'validation.notUnique');
  });

  it('rejects a table-wide unique child value repeated within one create, at the later path', async () => {
    const result = await runCreate('CUniq', { links: [{ slug: 'y' }, { slug: 'y' }] }, null);
    ok(!result.ok);
    strictEqual(result.errors['links[1].slug'], 'validation.notUnique');
  });

  it('rejects a table-wide unique child value repeated across sibling lists in one create', async () => {
    const result = await runCreate(
      'CNest',
      { sections: [{ links: [{ slug: 'z' }] }, { links: [{ slug: 'z' }] }] },
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[1].links[0].slug'], 'validation.notUnique');
  });
});

describe('runCreate hooks', () => {
  afterEach(() => useHooks().clear());

  it('runs `record:before-change` before coercion', async () => {
    hook('record:before-change', (input) => {
      input.views = 99;
    });
    const result = await runCreate('CPost', { ...base, title: 'HookBefore', views: 10 }, null);
    ok(result.ok);
    strictEqual((result.record as { views: number }).views, 99);
  });

  it('aborts on a `record:validate` failure and writes nothing', async () => {
    hook('record:validate', () => ({ title: 'validation.custom' }));
    const before = await db.query('SELECT "UUID" FROM "CPost"');
    const result = await runCreate('CPost', { ...base, title: 'HookValidate' }, null);
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.custom');
    const after = await db.query('SELECT "UUID" FROM "CPost"');
    strictEqual(after.length, before.length);
  });

  it('reshapes the returned record through `record:after-create`', async () => {
    hook('record:after-create', (record) => ({ ...record, title: 'PATCHED' }));
    const result = await runCreate('CPost', { ...base, title: 'HookAfter' }, null);
    ok(result.ok);
    strictEqual((result.record as { title: string }).title, 'PATCHED');
  });

  it('fires `record:committed` once for a self-owned create', async () => {
    const events: RecordCommitted[] = [];
    hook('record:committed', (event) => {
      events.push(event);
    });
    const result = await runCreate('CPost', { ...base, title: 'HookCommit' }, null);
    ok(result.ok);
    strictEqual(events.length, 1);
    strictEqual(events[0].operation, 'create');
    strictEqual(events[0].collection, 'CPost');
    deepStrictEqual(events[0].uuids, [(result.record as { UUID: string }).UUID]);
  });

  it('skips `record:committed` for a joined create', async () => {
    const events: RecordCommitted[] = [];
    hook('record:committed', (event) => {
      events.push(event);
    });
    await db.transaction(async (tx) => {
      const result = await runCreate('CPost', { ...base, title: 'HookJoined' }, null, tx);
      ok(result.ok);
    });
    strictEqual(events.length, 0);
  });
});

describe('runCreate links', () => {
  const onlyAnduin = async () => ({ where: { name: 'Anduin' } });
  const to = (record: string) => ({ collection: 'CUser', record });

  it('stores a live link beside a URL link', async () => {
    const result = await runCreate('CLinked', { links: [to(anduin), { url: '/a' }] }, null);
    ok(result.ok);
    deepStrictEqual(result.record.links, [to(anduin), { url: '/a' }]);
  });

  it('rejects a new dead link at its path', async () => {
    const result = await runCreate('CLinked', { links: [{ url: '/a' }, to(ghost)] }, null);
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'links[1]': 'validation.invalidReference' });
  });

  it('rejects a dead link inside a repeater item at its full path', async () => {
    const result = await runCreate('CLinked', { sections: [{ links: [to(ghost)] }] }, null);
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'sections[0].links[0]': 'validation.invalidReference' });
  });

  it('answers a hidden target exactly as a missing one', async () => {
    const create = (record: string) =>
      runCreate('CLinked', { links: [to(record)] }, null, undefined, false, onlyAnduin);
    const hidden = await create(liadrin);
    ok(!hidden.ok);
    deepStrictEqual(hidden.errors, { 'links[0]': 'validation.invalidReference' });
    deepStrictEqual(hidden, await create(ghost));
    ok((await create(anduin)).ok);
  });

  it('rejects a link to an unregistered collection, with or without a reach', async () => {
    const link = { collection: 'CNope', record: ghost };
    for (const reach of [undefined, onlyAnduin]) {
      const result = await runCreate('CLinked', { links: [link] }, null, undefined, false, reach);
      ok(!result.ok);
      deepStrictEqual(result.errors, { 'links[0]': 'validation.invalidReference' });
    }
  });
});
