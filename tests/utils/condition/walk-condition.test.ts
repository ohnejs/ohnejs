import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ConditionNode } from '../../../src/utils/condition/operators.ts';

import { parseCondition } from '../../../src/utils/condition/parse-condition.ts';
import { walkCondition } from '../../../src/utils/condition/walk-condition.ts';

function node(input: unknown): ConditionNode {
  const parsed = parseCondition(input);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return parsed.node;
}

function trace(root: ConditionNode): string[] {
  const visits: string[] = [];
  walkCondition(root, (child, { depth, hasDepth }) => {
    visits.push(`${child.kind}:${depth}:${hasDepth}`);
  });
  return visits;
}

describe('walkCondition', () => {
  it('visits pre-order with the root at depth 0', () => {
    deepStrictEqual(trace(node({ a: 1, or: [{ b: 2 }, { c: 3 }] })), [
      'and:0:0',
      'compare:1:0',
      'or:1:0',
      'compare:2:0',
      'compare:2:0',
    ]);
  });

  it('increments hasDepth only across has boundaries', () => {
    deepStrictEqual(trace(node({ author: { has: { posts: { has: { title: 'x' } } } } })), [
      'has:0:0',
      'has:1:1',
      'compare:2:2',
    ]);
  });

  it('does not descend into a bare has', () => {
    deepStrictEqual(trace(node({ author: { has: true } })), ['has:0:0']);
  });

  it('keeps hasDepth flat under and/or inside a has', () => {
    deepStrictEqual(trace(node({ author: { has: { a: 1, b: 2 } } })), [
      'has:0:0',
      'and:1:1',
      'compare:2:1',
      'compare:2:1',
    ]);
  });

  it('visits every node exactly once', () => {
    let count = 0;
    walkCondition(node({ a: 1, and: [{ b: 2 }, { c: 3 }], or: [] }), () => count++);
    strictEqual(count, 6);
  });
});
