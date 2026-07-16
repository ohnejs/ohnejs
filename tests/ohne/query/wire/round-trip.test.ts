import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type CompareOperator,
  compareOperators,
  type ConditionNode,
  type OperatorValueKind,
  parseCondition,
  parseSearchParams,
  serializeCondition,
  stringifySearchParams,
} from '../../../../src/utils/index.ts';

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
// Number-, boolean-, and null-looking strings exercise the backtick-forcing that keeps a value's
// JSON kind across the wire: '7' must stay a string, 7 a number.
const SCALARS = ['ohne', '', 0, 7, 2.5, true, false, '7', 'true', 'null'] as const;
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
  if (kind === 'ordinal') return pick(rnd, ['abc', 'zz', 42, 3.5, '7']);
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

describe('the wire round-trip preserves any condition', () => {
  it('serializes -> stringifies -> parses -> parses back to the same AST, 500 times', () => {
    const rnd = mulberry32(20260715);
    for (let i = 0; i < 500; i++) {
      const node = genNode(rnd, 0);
      const wire = stringifySearchParams({ where: serializeCondition(node) });
      const params = parseSearchParams(wire);
      const parsed = parseCondition(params.where);
      ok(parsed.ok, `iteration ${i} failed to parse \`${wire}\`: ${JSON.stringify(node)}`);
      deepStrictEqual(parsed.node, node, `iteration ${i} did not round-trip via \`${wire}\``);
    }
  });
});
