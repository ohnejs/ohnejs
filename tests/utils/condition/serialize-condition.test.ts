import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  compareOperators,
  type CompareOperator,
  type ConditionNode,
  type OperatorValueKind,
} from '../../../src/utils/condition/operators.ts';
import { parseCondition } from '../../../src/utils/condition/parse-condition.ts';
import { serializeCondition } from '../../../src/utils/condition/serialize-condition.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function pick<T>(rnd: Random, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)];
}

const WORDS = ['title', 'views', 'status', 'author', 'tags', 'city'] as const;
const SCALARS = ['ohne', '', 0, 7, 2.5, true, false] as const;
const OPS = Object.keys(compareOperators) as CompareOperator[];

function genPath(rnd: Random): string[] {
  const segments: string[] = [];
  const anchor = rnd();
  if (anchor < 0.15) segments.push('/');
  else if (anchor < 0.3) for (let i = Math.floor(rnd() * 2); i >= 0; i--) segments.push('..');
  segments.push(pick(rnd, WORDS));
  if (rnd() < 0.3) segments.push(pick(rnd, WORDS));
  return segments;
}

function genValue(rnd: Random, kind: OperatorValueKind): unknown {
  if (kind === 'scalar') return pick(rnd, SCALARS);
  if (kind === 'scalar[]') {
    return Array.from({ length: Math.floor(rnd() * 4) }, () => pick(rnd, SCALARS));
  }
  if (kind === 'ordinal') return pick(rnd, ['abc', 'zz', 42, 3.5]);
  return pick(rnd, ['ohne', 'o%e', 'a_c', '']);
}

function genNode(rnd: Random, depth: number): ConditionNode {
  const kinds =
    depth >= 3
      ? (['compare', 'compare', 'has', 'empty'] as const)
      : (['compare', 'compare', 'compare', 'has', 'empty', 'and', 'or'] as const);
  const kind = pick(rnd, kinds);
  const negated = rnd() < 0.3;
  if (kind === 'compare') {
    const op = pick(rnd, OPS);
    if (op === 'isNull') return { kind, path: genPath(rnd), op, negated };
    return {
      kind,
      path: genPath(rnd),
      op,
      value: genValue(rnd, compareOperators[op].value),
      negated,
    };
  }
  if (kind === 'has') {
    const condition = depth >= 3 || rnd() < 0.4 ? null : genNode(rnd, depth + 1);
    return { kind, path: genPath(rnd), condition, negated };
  }
  if (kind === 'empty') return { kind, path: genPath(rnd), negated };
  const count = pick(rnd, [0, 2, 2, 3]);
  return { kind, nodes: Array.from({ length: count }, () => genNode(rnd, depth + 1)) };
}

describe('serializeCondition', () => {
  it('emits the scalar shorthand for un-negated equalsTo', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'compare',
        path: ['status'],
        op: 'equalsTo',
        value: 'published',
        negated: false,
      }),
      { status: 'published' },
    );
  });

  it('wraps a negated leaf in not', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'compare',
        path: ['status'],
        op: 'equalsTo',
        value: 'draft',
        negated: true,
      }),
      { status: { not: { equalsTo: 'draft' } } },
    );
    deepStrictEqual(serializeCondition({ kind: 'empty', path: ['tags'], negated: true }), {
      tags: { not: { empty: true } },
    });
  });

  it('emits isNull as literal true', () => {
    deepStrictEqual(
      serializeCondition({ kind: 'compare', path: ['publishedAt'], op: 'isNull', negated: false }),
      { publishedAt: { isNull: true } },
    );
  });

  it('merges and-children claiming distinct keys into one object', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'and',
        nodes: [
          { kind: 'compare', path: ['a'], op: 'equalsTo', value: 1, negated: false },
          { kind: 'compare', path: ['b'], op: 'atLeast', value: 2, negated: false },
        ],
      }),
      { a: 1, b: { atLeast: 2 } },
    );
  });

  it('falls back to an and array on key collisions', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'and',
        nodes: [
          { kind: 'compare', path: ['v'], op: 'atLeast', value: 1, negated: false },
          { kind: 'compare', path: ['v'], op: 'atMost', value: 9, negated: false },
        ],
      }),
      { and: [{ v: { atLeast: 1 } }, { v: { atMost: 9 } }] },
    );
  });

  it('emits or as an array', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'or',
        nodes: [
          { kind: 'compare', path: ['a'], op: 'equalsTo', value: 1, negated: false },
          { kind: 'compare', path: ['b'], op: 'equalsTo', value: 2, negated: false },
        ],
      }),
      { or: [{ a: 1 }, { b: 2 }] },
    );
  });

  it('re-joins path anchors', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'compare',
        path: ['/', 'address', 'city'],
        op: 'equalsTo',
        value: 'x',
        negated: false,
      }),
      { '/address.city': 'x' },
    );
    deepStrictEqual(
      serializeCondition({ kind: 'empty', path: ['..', '..', 'tags'], negated: false }),
      { '../../tags': { empty: true } },
    );
  });

  it('serializes nested has conditions recursively', () => {
    deepStrictEqual(
      serializeCondition({
        kind: 'has',
        path: ['author'],
        condition: {
          kind: 'compare',
          path: ['name'],
          op: 'equalsTo',
          value: 'Azshara',
          negated: false,
        },
        negated: true,
      }),
      { author: { not: { has: { name: 'Azshara' } } } },
    );
  });

  it('writes a __proto__ path as an own key without polluting', () => {
    const out = serializeCondition({
      kind: 'compare',
      path: ['__proto__'],
      op: 'equalsTo',
      value: 1,
      negated: false,
    });
    strictEqual(Object.hasOwn(out, '__proto__'), true);
    strictEqual(Object.getPrototypeOf(out), Object.prototype);
    strictEqual(({} as { equalsTo?: unknown }).equalsTo, undefined);
  });

  it('round-trips 200 random ASTs through serialize -> parse', () => {
    const rnd = mulberry32(1337);
    for (let i = 0; i < 200; i++) {
      const node = genNode(rnd, 0);
      const parsed = parseCondition(serializeCondition(node));
      ok(parsed.ok, `iteration ${i} failed to parse: ${JSON.stringify(node)}`);
      deepStrictEqual(parsed.node, node, `iteration ${i} did not round-trip`);
    }
  });
});
