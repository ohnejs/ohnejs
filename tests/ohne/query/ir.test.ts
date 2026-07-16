import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { freezeIR } from '../../../src/ohne/query/ir.ts';

describe('freezeIR deep-freezes the populate tree', () => {
  const ir = freezeIR({
    collection: 'Posts',
    conditions: [],
    select: null,
    order: [],
    limit: null,
    offset: null,
    populate: [
      {
        field: 'comments',
        select: ['text'],
        children: [{ field: 'author', select: null, children: [] }],
      },
    ],
    locale: null,
  });

  it('freezes the list, every node, each subselect, and each children list', () => {
    const root = ir.populate[0];
    ok(Object.isFrozen(ir.populate));
    ok(Object.isFrozen(root));
    ok(Object.isFrozen(root?.select));
    ok(Object.isFrozen(root?.children));
    ok(Object.isFrozen(root?.children[0]));
  });

  it('keeps a bare child as the null-select empty-children shape', () => {
    const child = ir.populate[0]?.children[0];
    strictEqual(child?.field, 'author');
    strictEqual(child?.select, null);
    strictEqual(child?.children.length, 0);
  });
});
