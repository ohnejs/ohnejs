import { notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ConditionNode } from '../../../src/utils/index.ts';

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
    wire: null,
    unscoped: false,
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

describe('freezeIR deep-freezes the condition tree and order entries', () => {
  const compare: ConditionNode = {
    kind: 'compare',
    path: ['title'],
    op: 'in',
    value: ['Alpha'],
    negated: false,
  };
  const has: ConditionNode = {
    kind: 'has',
    path: ['author'],
    condition: { kind: 'compare', path: ['name'], op: 'equalsTo', value: 'Anduin', negated: false },
    negated: false,
  };
  const ir = freezeIR({
    collection: 'Posts',
    conditions: [compare, has],
    select: null,
    order: [{ field: 'title', direction: 'asc' }],
    limit: null,
    offset: null,
    populate: [],
    locale: null,
    wire: null,
    unscoped: false,
  });
  const folded = ir.condition as Extract<ConditionNode, { kind: 'and' }>;

  it('freezes the folded node, every leaf, each path, and each value list', () => {
    const leaf = folded.nodes[0] as Extract<ConditionNode, { kind: 'compare' }>;
    const nested = folded.nodes[1] as Extract<ConditionNode, { kind: 'has' }>;
    ok(Object.isFrozen(folded));
    ok(Object.isFrozen(folded.nodes));
    ok(Object.isFrozen(leaf));
    ok(Object.isFrozen(leaf.path));
    ok(Object.isFrozen(leaf.value));
    ok(Object.isFrozen(nested));
    ok(Object.isFrozen(nested.condition));
  });

  it('freezes each order entry', () => {
    ok(Object.isFrozen(ir.order));
    ok(Object.isFrozen(ir.order[0]));
  });

  it('copies, leaving the builder-owned nodes unfrozen', () => {
    notStrictEqual(folded.nodes[0], compare);
    notStrictEqual(folded.nodes[1], has);
    ok(!Object.isFrozen(compare));
    ok(!Object.isFrozen(has));
    ok(!Object.isFrozen(compare.value));
  });

  it('freezes a lone condition without the and fold', () => {
    const lone = freezeIR({
      collection: 'Posts',
      conditions: [compare],
      select: null,
      order: [],
      limit: null,
      offset: null,
      populate: [],
      locale: null,
      wire: null,
      unscoped: false,
    });
    strictEqual(lone.condition?.kind, 'compare');
    notStrictEqual(lone.condition, compare);
    ok(Object.isFrozen(lone.condition));
  });
});
