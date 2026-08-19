import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardBlock, DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import {
  carryValue,
  itemFormSupports,
  sanitizeItem,
} from '../../../src/dashboard/fields/_items.ts';

function field(name: string, over: Partial<DashboardField> = {}): DashboardField {
  return {
    name,
    type: 'text',
    kind: 'column',
    logicalType: 'text',
    label: name,
    nullable: false,
    required: false,
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
    ...over,
  };
}

function blocksField(name: string, allow: string[]): DashboardField {
  return field(name, { type: 'blocks', kind: 'blocks', logicalType: undefined, allow });
}

function block(name: string, fields: DashboardField[]): DashboardBlock {
  return { name, label: name, fields: [field('UUID', { writable: false }), ...fields] };
}

describe('itemFormSupports', () => {
  it('refuses a write-only subfield, at any depth', () => {
    strictEqual(itemFormSupports([field('a'), field('b', { readable: false })], []), false);
    const nested = field('child', {
      kind: 'childOne',
      subfields: [field('deep', { readable: false })],
    });
    strictEqual(itemFormSupports([nested], []), false);
  });

  it('permits the item `UUID` even though it is not writable', () => {
    strictEqual(itemFormSupports([field('UUID', { writable: false })], []), true);
  });

  it('supports a blocks subfield once every admitted type is described', () => {
    const blocks = [block('Quote', [field('words')])];
    strictEqual(itemFormSupports([blocksField('body', ['Quote'])], blocks), true);
  });

  it('refuses a blocks subfield naming a type the discovery read omits', () => {
    strictEqual(itemFormSupports([blocksField('body', ['Ghost'])], []), false);
  });

  it('refuses a blocks subfield whose block holds a write-only field', () => {
    const blocks = [block('Hero', [field('secret', { readable: false })])];
    strictEqual(itemFormSupports([blocksField('body', ['Hero'])], blocks), false);
  });

  it('terminates on a block admitting its own type', () => {
    const blocks = [block('Columns', [field('heading'), blocksField('inner', ['Columns'])])];
    strictEqual(itemFormSupports([blocksField('body', ['Columns'])], blocks), true);
  });

  it('terminates on a cycle between two block types', () => {
    const blocks = [
      block('Left', [blocksField('next', ['Right'])]),
      block('Right', [blocksField('back', ['Left'])]),
    ];
    strictEqual(itemFormSupports([blocksField('body', ['Left'])], blocks), true);
  });

  it('still refuses through a cycle when a reachable type is unsupported', () => {
    const blocks = [
      block('Loop', [blocksField('self', ['Loop']), blocksField('out', ['Bad'])]),
      block('Bad', [field('secret', { readable: false })]),
    ];
    strictEqual(itemFormSupports([blocksField('body', ['Loop'])], blocks), false);
  });
});

describe('carryValue over a blocks field', () => {
  const blocks = [
    block('Hero', [field('title'), field('slug', { immutable: true })]),
    block('Quote', [field('words'), blocksField('inner', ['Hero'])]),
  ];
  const body = blocksField('body', ['Hero', 'Quote']);

  it('lifts the instance `UUID` onto the envelope, never into `fields`', () => {
    const carried = carryValue(
      body,
      [{ block: 'Hero', UUID: 'u1', fields: { title: 'T', slug: 'kept' } }],
      blocks,
    );
    deepStrictEqual(carried, [{ block: 'Hero', UUID: 'u1', fields: { title: 'T' } }]);
  });

  it('omits the envelope `UUID` when the item has none, as a create demands', () => {
    const carried = carryValue(body, [{ block: 'Hero', fields: { title: 'T' } }], blocks);
    deepStrictEqual(carried, [{ block: 'Hero', fields: { title: 'T' } }]);
  });

  it('carries a nested blocks list recursively', () => {
    const carried = carryValue(
      body,
      [
        {
          block: 'Quote',
          UUID: 'q1',
          fields: {
            words: 'W',
            inner: [{ block: 'Hero', UUID: 'h1', fields: { title: 'N', slug: 'gone' } }],
          },
        },
      ],
      blocks,
    );
    deepStrictEqual(carried, [
      {
        block: 'Quote',
        UUID: 'q1',
        fields: { words: 'W', inner: [{ block: 'Hero', UUID: 'h1', fields: { title: 'N' } }] },
      },
    ]);
  });

  it('passes an undescribed type through whole, so the server refuses it visibly', () => {
    const carried = carryValue(
      body,
      [{ block: 'Legacy', UUID: 'l1', fields: { anything: 1 } }],
      blocks,
    );
    deepStrictEqual(carried, [{ block: 'Legacy', UUID: 'l1', fields: { anything: 1 } }]);
  });

  it('reads a missing or malformed list as empty', () => {
    deepStrictEqual(carryValue(body, null, blocks), []);
    deepStrictEqual(carryValue(body, ['nope', 3], blocks), []);
  });
});

describe('sanitizeItem', () => {
  const blocks = [block('Quote', [field('words')])];

  it('keeps only writable, mutable, non-`UUID` keys and drops the unknown', () => {
    const fields = [
      field('kept'),
      field('locked', { immutable: true }),
      field('derived', { writable: false }),
      field('UUID', { writable: false }),
    ];
    const clean = sanitizeItem(
      fields,
      { kept: 'a', locked: 'b', derived: 'c', UUID: 'u1', stray: 'd' },
      false,
      blocks,
    );
    deepStrictEqual(clean, { kept: 'a' });
  });

  it('re-attaches the item `UUID` only when asked', () => {
    const fields = [field('UUID', { writable: false }), field('kept')];
    deepStrictEqual(sanitizeItem(fields, { UUID: 'u1', kept: 'a' }, true, blocks), {
      kept: 'a',
      UUID: 'u1',
    });
  });

  it('rebuilds a blocks subfield into envelopes', () => {
    const fields = [field('kept'), blocksField('body', ['Quote'])];
    const clean = sanitizeItem(
      fields,
      { kept: 'a', body: [{ block: 'Quote', UUID: 'q1', fields: { words: 'W', stray: 'x' } }] },
      false,
      blocks,
    );
    deepStrictEqual(clean, {
      kept: 'a',
      body: [{ block: 'Quote', UUID: 'q1', fields: { words: 'W' } }],
    });
  });
});
