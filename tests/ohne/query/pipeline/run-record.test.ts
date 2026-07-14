import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { runRecord } from '../../../../src/ohne/query/pipeline/run-record.ts';

const sectionFields = { heading: field('text') };
const metaFields = { note: field('text', { nullable: true }) };

useCollections().register('PPost', {
  name: 'PPost',
  collection: {
    fields: {
      title: field('text'),
      summary: field('text', { nullable: true }),
      views: field('integer'),
      author: field('record', { collection: 'PUser' }),
      tags: field('records', { collection: 'PTag' }),
      meta: field('object', { fields: metaFields }),
      sections: field('repeater', { fields: sectionFields }),
    },
  },
});

useCollections().register('PList', {
  name: 'PList',
  collection: {
    fields: {
      items: field('repeater', {
        fields: { code: field('text', { unique: true, uniquePerParent: true }) },
      }),
    },
  },
});

useCollections().register('PGlobal', {
  name: 'PGlobal',
  collection: {
    fields: { items: field('repeater', { fields: { code: field('text', { unique: true }) } }) },
  },
});

const tx = {} as Transaction;

async function create(input: Record<string, unknown>) {
  return runRecord(queryMetadata('PPost'), input, { operation: 'create', tx });
}

const full = {
  title: 'Hello',
  views: 10,
  author: 'u1',
  tags: ['t1', 't2'],
  meta: { note: 'n' },
  sections: [{ heading: 'a' }, { heading: 'b' }],
};

describe('runRecord (create)', () => {
  it('validates and serializes a full record', async () => {
    const result = await create(full);
    ok(result.ok);
    strictEqual(result.scope.columns.title, 'Hello');
    strictEqual(result.scope.columns.views, 10);
    strictEqual(result.scope.columns.author, 'u1');
    strictEqual(result.scope.columns.summary, null);
    deepStrictEqual(result.scope.relations[0].uuids, ['t1', 't2']);
    strictEqual(result.scope.children.length, 2);
  });

  it('coerces a column value toward its storage primitive', async () => {
    const result = await create({ ...full, views: '42' });
    ok(result.ok);
    strictEqual(result.scope.columns.views, 42);
  });

  it('defaults an absent nullable column to null', async () => {
    const result = await create(full);
    ok(result.ok);
    strictEqual(result.scope.columns.summary, null);
  });

  it('reports a missing required field', async () => {
    const { title: _drop, ...rest } = full;
    const result = await create(rest);
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.required');
  });

  it('rejects null on a non-nullable field', async () => {
    const result = await create({ ...full, title: null });
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.notNullable');
  });

  it('rejects an empty string on a text field by default', async () => {
    const result = await create({ ...full, title: '' });
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.emptyValue');
  });

  it('rejects a non-safe integer', async () => {
    const result = await create({ ...full, views: Number.MAX_SAFE_INTEGER + 2 });
    ok(!result.ok);
    strictEqual(result.errors.views, 'validation.invalidValue');
  });

  it('rejects an unknown input key', async () => {
    const result = await create({ ...full, mystery: 1 });
    ok(!result.ok);
    strictEqual(result.errors.mystery, 'validation.unknownField');
  });

  it('collects a reference per record and records link, at its path', async () => {
    const result = await create(full);
    ok(result.ok);
    const paths = result.scope.refs.map((r) => `${r.target}:${r.path}:${r.uuid}`);
    ok(paths.includes('PUser:author:u1'));
    ok(paths.includes('PTag:tags[0]:t1'));
    ok(paths.includes('PTag:tags[1]:t2'));
  });

  it('rejects null for a records list', async () => {
    const result = await create({ ...full, tags: null });
    ok(!result.ok);
    strictEqual(result.errors.tags, 'validation.notNullable');
  });

  it('rejects a repeated UUID in a records list at the field', async () => {
    const result = await create({ ...full, tags: ['t1', 't1'] });
    ok(!result.ok);
    strictEqual(result.errors.tags, 'validation.notUnique');
  });

  it('rejects a repeated value on a uniquePerParent subfield at the item path', async () => {
    const result = await runRecord(
      queryMetadata('PList'),
      { items: [{ code: 'a' }, { code: 'a' }] },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    strictEqual(result.errors['items[1].code'], 'validation.notUnique');
  });

  it('gathers a probe per table-wide unique subfield value, at its item path', async () => {
    const result = await runRecord(
      queryMetadata('PGlobal'),
      { items: [{ code: 'a' }, { code: 'b' }] },
      { operation: 'create', tx },
    );
    ok(result.ok);
    deepStrictEqual(
      result.scope.uniqueProbes.map((p) => `${p.table}:${p.column}:${p.value}:${p.path}`),
      ['PGlobal_items:code:a:items[0].code', 'PGlobal_items:code:b:items[1].code'],
    );
  });

  it('rejects a reserved input key instead of silently dropping it', async () => {
    const input: Record<string, unknown> = { ...full };
    Object.defineProperty(input, '__proto__', {
      value: 'x',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const result = await create(input);
    ok(!result.ok);
    strictEqual(Object.hasOwn(result.errors, '__proto__'), true);
    strictEqual(result.errors['__proto__'], 'validation.unknownField');
  });

  it('errors inside a repeater item at its dot-path', async () => {
    const result = await create({ ...full, sections: [{ heading: 'ok' }, { heading: '' }] });
    ok(!result.ok);
    strictEqual(result.errors['sections[1].heading'], 'validation.emptyValue');
  });

  it('errors inside an object child at its dot-path', async () => {
    const result = await create({ ...full, meta: { note: '' } });
    ok(!result.ok);
    strictEqual(result.errors['meta.note'], 'validation.emptyValue');
  });

  it('skips absent fields on update, writing only what is provided', async () => {
    const result = await runRecord(
      queryMetadata('PPost'),
      { title: 'Edit' },
      {
        operation: 'update',
        tx,
      },
    );
    ok(result.ok);
    deepStrictEqual(Object.keys(result.scope.columns), ['title']);
  });
});
