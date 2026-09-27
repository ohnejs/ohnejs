import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
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
      rating: field('number', { nullable: true }),
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

useCollections().register('PFrozen', {
  name: 'PFrozen',
  collection: {
    fields: {
      a: field('text', {
        validators: [
          (_value, ctx) => (Object.isFrozen(ctx.input) ? undefined : 'input not frozen'),
        ],
      }),
    },
  },
});

useBlocks().register('PHero', { name: 'PHero', block: { fields: { title: field('text') } } });
useBlocks().register('PBadge', {
  name: 'PBadge',
  block: { fields: { slug: field('text', { unique: true }) } },
});

useCollections().register('PBlocky', {
  name: 'PBlocky',
  collection: { fields: { content: field('blocks', { allow: ['PHero', 'PBadge'] }) } },
});

useCollections().register('PStrict', {
  name: 'PStrict',
  collection: {
    fields: {
      tags: field('records', { collection: 'PTag', allowEmpty: false }),
      sections: field('repeater', { fields: sectionFields, allowEmpty: false }),
      content: field('blocks', { allow: ['PHero'], allowEmpty: false }),
    },
  },
});

useCollections().register('PGatedList', {
  name: 'PGatedList',
  collection: {
    fields: {
      kind: field('text'),
      items: field('repeater', {
        fields: sectionFields,
        allowEmpty: false,
        when: { kind: 'full' },
      }),
    },
  },
});

useCollections().register('PChoices', {
  name: 'PChoices',
  collection: {
    fields: {
      kind: field('text', { default: 'lite' }),
      tags: field('multiSelect', { min: 1 }),
      gated: field('multiSelect', { min: 1, when: { kind: 'full' } }),
      loose: field('multiSelect', { min: 1, nullable: true }),
      gatedLoose: field('multiSelect', { min: 1, nullable: true, when: { kind: 'full' } }),
    },
  },
});

useCollections().register('PNestedStrict', {
  name: 'PNestedStrict',
  collection: {
    fields: {
      sections: field('repeater', {
        fields: { links: field('records', { collection: 'PTag', min: 1 }) },
      }),
    },
  },
});

useCollections().register('PDeclaredEmpty', {
  name: 'PDeclaredEmpty',
  collection: { fields: { tags: field('multiSelect', { min: 1, default: () => [] }) } },
});

useCollections().register('PDefaults', {
  name: 'PDefaults',
  collection: {
    fields: {
      tags: field('records', { collection: 'PTag', max: 1, default: () => ['t1', 't2'] }),
      sections: field('repeater', {
        fields: sectionFields,
        default: () => [{ heading: 'a' }],
        sanitizers: [
          (value) =>
            (value as { heading: string }[]).map((item) => ({ heading: `${item.heading}!` })),
        ],
      }),
      meta: field('object', {
        fields: metaFields,
        default: () => ({ note: 'n' }),
        validators: [() => 'object-validator-ran'],
      }),
    },
  },
});

useCollections().register('PMalformed', {
  name: 'PMalformed',
  collection: {
    fields: { tags: field('records', { collection: 'PTag', default: () => 't1' as never }) },
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
    const result = await create({ ...full, views: '42', rating: '4.5' });
    ok(result.ok);
    strictEqual(result.scope.columns.views, 42);
    strictEqual(result.scope.columns.rating, 4.5);
  });

  it('stores a finite double as-is and rejects a non-finite one', async () => {
    const stored = await create({ ...full, rating: 1.5 });
    ok(stored.ok);
    strictEqual(stored.scope.columns.rating, 1.5);
    const rejected = await create({ ...full, rating: Infinity });
    ok(!rejected.ok);
    strictEqual(rejected.errors.rating, 'validation.invalidValue');
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

  it('treats an explicit undefined as absent, never as a value', async () => {
    const created = await create({ ...full, summary: undefined });
    ok(created.ok);
    strictEqual(created.scope.columns.summary, null);
    const missing = await create({ ...full, title: undefined });
    ok(!missing.ok);
    strictEqual(missing.errors.title, 'validation.required');
    const updated = await runRecord(
      queryMetadata('PPost'),
      { title: undefined },
      { operation: 'update', tx },
    );
    ok(updated.ok);
    deepStrictEqual(updated.scope.columns, {});
  });

  it("freezes a copy of the input, leaving the caller's object untouched", async () => {
    const input = { ...full };
    const result = await create(input);
    ok(result.ok);
    ok(!Object.isFrozen(input));
    strictEqual(input.title, 'Hello');
    const seen = await runRecord(queryMetadata('PFrozen'), { a: 'x' }, { operation: 'create', tx });
    ok(seen.ok);
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

describe('runRecord list emptiness', () => {
  it('accepts an empty list by default on records, repeater, and blocks', async () => {
    const result = await create({ ...full, tags: [], sections: [] });
    ok(result.ok);
    const blocky = await runRecord(
      queryMetadata('PBlocky'),
      { content: [] },
      { operation: 'create', tx },
    );
    ok(blocky.ok);
  });

  it('rejects a provided empty list when allowEmpty is false, per kind', async () => {
    const result = await runRecord(
      queryMetadata('PStrict'),
      { tags: [], sections: [], content: [] },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    strictEqual(result.errors.tags, 'validation.emptyValue');
    strictEqual(result.errors.sections, 'validation.emptyValue');
    strictEqual(result.errors.content, 'validation.emptyValue');
  });

  it('lands the trusted empty default for an inactive allowEmpty: false list', async () => {
    const result = await runRecord(
      queryMetadata('PGatedList'),
      { kind: 'lite' },
      { operation: 'create', tx },
    );
    ok(result.ok);
    deepStrictEqual(result.scope.children[0].items, []);
  });

  it('drops a provided empty list on an inactive field instead of rejecting it', async () => {
    const result = await runRecord(
      queryMetadata('PGatedList'),
      { kind: 'lite', items: [] },
      { operation: 'create', tx },
    );
    ok(result.ok);
    deepStrictEqual(result.scope.children[0].items, []);
  });

  it('rejects an empty list on the same field once its gate activates', async () => {
    const result = await runRecord(
      queryMetadata('PGatedList'),
      { kind: 'full', items: [] },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    strictEqual(result.errors.items, 'validation.emptyValue');
  });

  it('requires a list that forbids empty when a create omits it, per kind', async () => {
    const result = await runRecord(queryMetadata('PStrict'), {}, { operation: 'create', tx });
    ok(!result.ok);
    deepStrictEqual(
      { ...result.errors },
      {
        tags: 'validation.required',
        sections: 'validation.required',
        content: 'validation.required',
      },
    );
  });

  it('requires a gated list that forbids empty once its gate activates', async () => {
    const result = await runRecord(
      queryMetadata('PGatedList'),
      { kind: 'full' },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    strictEqual(result.errors.items, 'validation.required');
  });

  it('requires a multiSelect with a `min` when a create omits it', async () => {
    const result = await runRecord(queryMetadata('PChoices'), {}, { operation: 'create', tx });
    ok(!result.ok);
    deepStrictEqual({ ...result.errors }, { tags: 'validation.required' });
  });

  it("lands an inactive multiSelect's own `[]` past `min`, and `null` on an omitted nullable one", async () => {
    const result = await runRecord(
      queryMetadata('PChoices'),
      { tags: ['a'], gated: ['b'] },
      { operation: 'create', tx },
    );
    ok(result.ok);
    deepStrictEqual(result.scope.columns.gated, []);
    strictEqual(result.scope.columns.loose, null);
  });

  it('lands the same inactive fallback whether the list was sent or omitted', async () => {
    const meta = queryMetadata('PChoices');
    const sent = await runRecord(
      meta,
      { tags: ['a'], gated: ['b'], gatedLoose: ['c'] },
      { operation: 'create', tx },
    );
    const omitted = await runRecord(meta, { tags: ['a'] }, { operation: 'create', tx });
    ok(sent.ok);
    ok(omitted.ok);
    deepStrictEqual(sent.scope.columns.gated, []);
    deepStrictEqual(omitted.scope.columns.gated, []);
    strictEqual(sent.scope.columns.gatedLoose, null);
    strictEqual(omitted.scope.columns.gatedLoose, null);
  });

  it('rejects a provided empty multiSelect below `min`', async () => {
    const result = await runRecord(
      queryMetadata('PChoices'),
      { kind: 'full', tags: [], gated: [] },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    deepStrictEqual(result.errors.tags, { key: 'validation.minItems', params: { min: 1 } });
    deepStrictEqual(result.errors.gated, { key: 'validation.minItems', params: { min: 1 } });
  });

  it('runs a declared empty default through the tiers, so `min` rejects it', async () => {
    const result = await runRecord(
      queryMetadata('PDeclaredEmpty'),
      {},
      { operation: 'create', tx },
    );
    ok(!result.ok);
    deepStrictEqual(result.errors.tags, { key: 'validation.minItems', params: { min: 1 } });
  });
});

describe('runRecord nested items that omit a required list', () => {
  it('treats an explicit undefined as absent, failing `required` instead of throwing', async () => {
    const result = await runRecord(
      queryMetadata('PNestedStrict'),
      { sections: [{ links: undefined }] },
      { operation: 'create', tx },
    );
    ok(!result.ok);
    deepStrictEqual({ ...result.errors }, { 'sections[0].links': 'validation.required' });
  });
});

describe('runRecord declared composite defaults', () => {
  it("runs each field's own tiers over its declared default", async () => {
    const result = await runRecord(queryMetadata('PDefaults'), {}, { operation: 'create', tx });
    ok(!result.ok);
    deepStrictEqual(result.errors.tags, { key: 'validation.maxItems', params: { max: 1 } });
    strictEqual(result.errors.meta, 'object-validator-ran');
    strictEqual(result.errors.sections, undefined);
  });

  it('lands the sanitized default when the tiers accept it', async () => {
    const result = await runRecord(
      queryMetadata('PDefaults'),
      { tags: ['t1'], meta: null },
      { operation: 'create', tx },
    );
    ok(result.ok);
    const sections = result.scope.children.find((child) => child.path === 'sections');
    strictEqual(sections?.items[0].columns.heading, 'a!');
  });

  it('rejects a declared default of the wrong shape at the field', async () => {
    const result = await runRecord(queryMetadata('PMalformed'), {}, { operation: 'create', tx });
    ok(!result.ok);
    strictEqual(result.errors.tags, 'validation.invalidValue');
  });
});

describe('runRecord (blocks)', () => {
  async function createBlocky(input: Record<string, unknown>) {
    return runRecord(queryMetadata('PBlocky'), input, { operation: 'create', tx });
  }

  it('processes blocks items into tagged child scopes, in input order', async () => {
    const result = await createBlocky({
      content: [
        { block: 'PHero', fields: { title: 'A' } },
        { block: 'PBadge', fields: { slug: 's' } },
      ],
    });
    ok(result.ok);
    const child = result.scope.children[0];
    strictEqual(child.meta.kind, 'blocks');
    strictEqual(child.path, 'content');
    strictEqual(child.items[0].blockType, 'PHero');
    strictEqual(child.items[0].columns.title, 'A');
    strictEqual(child.items[1].blockType, 'PBadge');
    strictEqual(child.items[1].columns.slug, 's');
  });

  it('aims a unique block subfield probe at the shared per-type table', async () => {
    const result = await createBlocky({
      content: [
        { block: 'PHero', fields: { title: 'A' } },
        { block: 'PBadge', fields: { slug: 's' } },
      ],
    });
    ok(result.ok);
    deepStrictEqual(
      result.scope.uniqueProbes.map((p) => `${p.table}:${p.column}:${p.value}:${p.path}`),
      ['block_PBadge:slug:s:content[1].fields.slug'],
    );
  });

  it('rejects null and malformed blocks lists', async () => {
    const nulled = await createBlocky({ content: null });
    ok(!nulled.ok);
    strictEqual(nulled.errors.content, 'validation.notNullable');
    const scalar = await createBlocky({ content: 'x' });
    ok(!scalar.ok);
    strictEqual(scalar.errors.content, 'validation.invalidValue');
    const nonObject = await createBlocky({ content: [1] });
    ok(!nonObject.ok);
    strictEqual(nonObject.errors.content, 'validation.invalidValue');
  });

  it('errors inside a block item at its fields dot-path', async () => {
    const result = await createBlocky({ content: [{ block: 'PHero', fields: { title: '' } }] });
    ok(!result.ok);
    strictEqual(result.errors['content[0].fields.title'], 'validation.emptyValue');
  });

  it('rejects an unknown subfield inside a block item at its path', async () => {
    const result = await createBlocky({
      content: [{ block: 'PHero', fields: { title: 'A', bogus: 1 } }],
    });
    ok(!result.ok);
    strictEqual(result.errors['content[0].fields.bogus'], 'validation.unknownField');
  });
});

describe('runRecord nested item identity', () => {
  it('errors a nested non-string item `UUID` at its own path, never double-prefixed', async () => {
    useCollections().register('PNested', {
      name: 'PNested',
      collection: {
        fields: {
          sections: field('repeater', {
            fields: { items: field('repeater', { fields: { label: field('text') } }) },
          }),
        },
      },
    });
    const result = await runRecord(
      queryMetadata('PNested'),
      { sections: [{ items: [{ label: 'x' }, { UUID: 5, label: 'y' }] }] },
      { operation: 'update', tx },
    );
    ok(!result.ok);
    deepStrictEqual(Object.keys(result.errors), ['sections[0].items[1].UUID']);
    strictEqual(result.errors['sections[0].items[1].UUID'], 'validation.invalidValue');
  });
});

describe('runRecord link provenance', () => {
  useBlocks().register('PLinkBlock', {
    name: 'PLinkBlock',
    block: { fields: { who: field('record', { collection: 'PUser' }) } },
  });
  useCollections().register('PLinks', {
    name: 'PLinks',
    collection: {
      fields: {
        owner: field('record', { collection: 'PUser', default: 'u-default' }),
        pick: field('record', { collection: 'PUser' }),
        tags: field('records', { collection: 'PTag' }),
        sections: field('repeater', {
          fields: {
            who: field('record', { collection: 'PUser' }),
            fallback: field('record', { collection: 'PUser', default: 'u-sub' }),
          },
        }),
        content: field('blocks', { allow: ['PLinkBlock'] }),
        preset: field('repeater', {
          fields: { who: field('record', { collection: 'PUser' }) },
          default: () => [{ who: 'u-preset' }],
        }),
      },
    },
  });

  it('marks a link the input supplies provided, and a default or snapshot link not', async () => {
    const result = await runRecord(
      queryMetadata('PLinks'),
      {
        pick: 'u1',
        tags: ['t1', 't2'],
        sections: [{ who: 'u2' }],
        content: [{ block: 'PLinkBlock', fields: { who: 'u3' } }],
      },
      { operation: 'create', tx },
    );
    ok(result.ok);
    const refs = result.scope.refs
      .map(({ path, uuid, provided }) => [path, uuid, provided])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
    deepStrictEqual(refs, [
      ['content[0].fields.who', 'u3', true],
      ['owner', 'u-default', false],
      ['pick', 'u1', true],
      ['preset[0].who', 'u-preset', false],
      ['sections[0].fallback', 'u-sub', false],
      ['sections[0].who', 'u2', true],
      ['tags[0]', 't1', true],
      ['tags[1]', 't2', true],
    ]);
  });

  describe('with a `record:before-change` hook', () => {
    afterEach(() => useHooks().clear());

    it('checks a link the hook sets like one the input sends', async () => {
      hook('record:before-change', (input) => {
        input.pick = 'u-hook';
      });
      const result = await runRecord(queryMetadata('PLinks'), {}, { operation: 'create', tx });
      ok(result.ok);
      const pick = result.scope.refs.find((ref) => ref.path === 'pick');
      strictEqual(pick?.provided, true);
    });
  });
});
