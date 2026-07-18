import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { CompareOperator, ConditionNode } from '../../../src/utils/condition/operators.ts';

import {
  parseCondition,
  type ConditionError,
  type ParseConditionOptions,
} from '../../../src/utils/condition/parse-condition.ts';

function node(input: unknown, options?: ParseConditionOptions): ConditionNode {
  const result = parseCondition(input, options);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.node;
}

function error(input: unknown, options?: ParseConditionOptions): ConditionError {
  const result = parseCondition(input, options);
  if (result.ok) throw new Error('expected a parse failure');
  return result.error;
}

function compare(
  path: string[],
  op: CompareOperator,
  value: unknown,
  negated = false,
): ConditionNode {
  return { kind: 'compare', path, op, value, negated };
}

describe('parseCondition', () => {
  it('parses the scalar shorthand as equalsTo', () => {
    deepStrictEqual(node({ title: 'ohne' }), compare(['title'], 'equalsTo', 'ohne'));
    deepStrictEqual(node({ featured: true }), compare(['featured'], 'equalsTo', true));
    deepStrictEqual(node({ views: 0 }), compare(['views'], 'equalsTo', 0));
  });

  it('ANDs sibling fields in key order', () => {
    deepStrictEqual(node({ a: 1, b: 2 }), {
      kind: 'and',
      nodes: [compare(['a'], 'equalsTo', 1), compare(['b'], 'equalsTo', 2)],
    });
  });

  it('accepts every operator with a value of its kind', () => {
    const samples: { [op in CompareOperator]: unknown } = {
      equalsTo: 'x',
      in: [1, 'two', true],
      greaterThan: 5,
      atLeast: 'm',
      lessThan: 5,
      atMost: 'm',
      contains: 'oh',
      startsWith: 'oh',
      endsWith: 'ne',
      like: 'o%e',
      isNull: true,
      includes: 'tag',
      includesAll: ['a', 'b'],
      includesAny: [],
    };
    for (const [op, value] of Object.entries(samples) as [CompareOperator, unknown][]) {
      const expected: ConditionNode =
        op === 'isNull'
          ? { kind: 'compare', path: ['f'], op, negated: false }
          : compare(['f'], op, value);
      deepStrictEqual(node({ f: { [op]: value } }), expected);
    }
  });

  it('ANDs multiple operator keys in one comparison', () => {
    deepStrictEqual(node({ views: { atLeast: 10, atMost: 20 } }), {
      kind: 'and',
      nodes: [compare(['views'], 'atLeast', 10), compare(['views'], 'atMost', 20)],
    });
  });

  it('ANDs a where-level or with its sibling fields', () => {
    deepStrictEqual(node({ f: 1, or: [{ a: 1 }, { b: 2 }] }), {
      kind: 'and',
      nodes: [
        compare(['f'], 'equalsTo', 1),
        { kind: 'or', nodes: [compare(['a'], 'equalsTo', 1), compare(['b'], 'equalsTo', 2)] },
      ],
    });
  });

  it('groups where-level and entries', () => {
    deepStrictEqual(node({ and: [{ a: 1 }, { b: 2 }] }), {
      kind: 'and',
      nodes: [compare(['a'], 'equalsTo', 1), compare(['b'], 'equalsTo', 2)],
    });
  });

  it('ORs a comparison against the AND of its sibling operators', () => {
    deepStrictEqual(node({ views: { atLeast: 100, or: [{ equalsTo: 0 }] } }), {
      kind: 'or',
      nodes: [compare(['views'], 'atLeast', 100), compare(['views'], 'equalsTo', 0)],
    });
    deepStrictEqual(node({ views: { or: [{ equalsTo: 0 }, { atLeast: 100 }] } }), {
      kind: 'or',
      nodes: [compare(['views'], 'equalsTo', 0), compare(['views'], 'atLeast', 100)],
    });
  });

  it('parses bare and nested has', () => {
    deepStrictEqual(node({ author: { has: true } }), {
      kind: 'has',
      path: ['author'],
      condition: null,
      negated: false,
    });
    deepStrictEqual(node({ author: { has: { name: 'Alice' } } }), {
      kind: 'has',
      path: ['author'],
      condition: compare(['name'], 'equalsTo', 'Alice'),
      negated: false,
    });
  });

  it('parses empty', () => {
    deepStrictEqual(node({ tags: { empty: true } }), {
      kind: 'empty',
      path: ['tags'],
      negated: false,
    });
  });

  it('tokenizes path anchors', () => {
    deepStrictEqual(
      node({ '/address.city': 'x' }),
      compare(['/', 'address', 'city'], 'equalsTo', 'x'),
    );
    deepStrictEqual(node({ '../status': 'x' }), compare(['..', 'status'], 'equalsTo', 'x'));
    deepStrictEqual(node({ '../../a': 'x' }), compare(['..', '..', 'a'], 'equalsTo', 'x'));
    deepStrictEqual(node({ '/../a': 'x' }), compare(['/', '..', 'a'], 'equalsTo', 'x'));
  });

  it('collapses single-child groups', () => {
    deepStrictEqual(node({ or: [{ a: 1 }] }), compare(['a'], 'equalsTo', 1));
    deepStrictEqual(node({ and: [{ a: 1 }] }), compare(['a'], 'equalsTo', 1));
  });

  it('keeps empty groups', () => {
    deepStrictEqual(node({}), { kind: 'and', nodes: [] });
    deepStrictEqual(node({ or: [] }), { kind: 'or', nodes: [] });
    deepStrictEqual(node({ and: [] }), { kind: 'and', nodes: [] });
  });

  it('folds a where-level not onto the leaf', () => {
    deepStrictEqual(node({ not: { a: 1 } }), compare(['a'], 'equalsTo', 1, true));
  });

  it('folds not over and via De Morgan', () => {
    deepStrictEqual(node({ not: { a: 1, b: 2 } }), {
      kind: 'or',
      nodes: [compare(['a'], 'equalsTo', 1, true), compare(['b'], 'equalsTo', 2, true)],
    });
  });

  it('folds not over or via De Morgan', () => {
    deepStrictEqual(node({ not: { or: [{ a: 1 }, { b: 2 }] } }), {
      kind: 'and',
      nodes: [compare(['a'], 'equalsTo', 1, true), compare(['b'], 'equalsTo', 2, true)],
    });
  });

  it('cancels double negation', () => {
    deepStrictEqual(node({ not: { not: { a: 1 } } }), compare(['a'], 'equalsTo', 1));
    deepStrictEqual(node({ a: { not: { not: { equalsTo: 1 } } } }), compare(['a'], 'equalsTo', 1));
  });

  it('negates a comparison not without a value key on isNull', () => {
    deepStrictEqual(node({ publishedAt: { not: { isNull: true } } }), {
      kind: 'compare',
      path: ['publishedAt'],
      op: 'isNull',
      negated: true,
    });
  });

  it('rejects a non-object root at the root path', () => {
    deepStrictEqual(error(5), { code: 'invalidShape', path: '' });
    deepStrictEqual(error(null), { code: 'invalidShape', path: '' });
    deepStrictEqual(error([{ a: 1 }]), { code: 'invalidShape', path: '' });
  });

  it('rejects null equality as nullEquality', () => {
    deepStrictEqual(error({ status: null }), {
      code: 'nullEquality',
      path: 'status',
      key: 'status',
    });
    deepStrictEqual(error({ v: { equalsTo: null } }), {
      code: 'nullEquality',
      path: 'v.equalsTo',
      key: 'equalsTo',
    });
    deepStrictEqual(error({ v: { in: [1, null] } }), {
      code: 'nullEquality',
      path: 'v.in',
      key: 'in',
    });
  });

  it('rejects unknown operators', () => {
    deepStrictEqual(error({ v: { equals: 1 } }), {
      code: 'unknownOperator',
      path: 'v.equals',
      key: 'equals',
    });
  });

  it('locates failures inside or branches', () => {
    deepStrictEqual(error({ or: [{ a: 1 }, { status: { equals: 1 } }] }), {
      code: 'unknownOperator',
      path: 'or[1].status.equals',
      key: 'equals',
    });
  });

  it('rejects wrong value kinds as invalidValue', () => {
    strictEqual(error({ v: { atLeast: true } }).code, 'invalidValue');
    strictEqual(error({ v: { in: 5 } }).code, 'invalidValue');
    strictEqual(error({ v: { in: [{}] } }).code, 'invalidValue');
    strictEqual(error({ v: { contains: 7 } }).code, 'invalidValue');
    strictEqual(error({ v: { equalsTo: [1] } }).code, 'invalidValue');
    strictEqual(error({ v: { includesAll: [null] } }).code, 'invalidValue');
    strictEqual(error({ v: { isNull: false } }).code, 'invalidValue');
    strictEqual(error({ v: { empty: false } }).code, 'invalidValue');
    strictEqual(error({ v: { has: 5 } }).code, 'invalidValue');
  });

  it('rejects malformed shapes as invalidShape', () => {
    strictEqual(error({ and: 5 }).code, 'invalidShape');
    strictEqual(error({ or: { a: 1 } }).code, 'invalidShape');
    strictEqual(error({ not: 5 }).code, 'invalidShape');
    strictEqual(error({ f: [1, 2] }).code, 'invalidShape');
    strictEqual(error({ '': 1 }).code, 'invalidShape');
    strictEqual(error({ '/': true }).code, 'invalidShape');
    strictEqual(error({ '../': true }).code, 'invalidShape');
    strictEqual(error({ 'a..b': 1 }).code, 'invalidShape');
    strictEqual(error({ 'a.': 1 }).code, 'invalidShape');
  });

  it('copies array operator values, so caller mutation never reaches the node', () => {
    const values = [1, 2];
    const parsed = node({ v: { in: values } });
    values.push(3);
    deepStrictEqual(parsed, compare(['v'], 'in', [1, 2]));
  });

  it('treats a literal __proto__ key as a field name without polluting', () => {
    deepStrictEqual(
      node(JSON.parse('{"__proto__": {"equalsTo": 1}}')),
      compare(['__proto__'], 'equalsTo', 1),
    );
    strictEqual(({} as { equalsTo?: unknown }).equalsTo, undefined);
    strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, 'equalsTo'), false);
  });

  it('accepts nesting at the cap and rejects past it', () => {
    const nested = (levels: number): unknown => {
      let where: unknown = { leaf: 1 };
      for (let i = 0; i < levels; i++) where = { rel: { has: where } };
      return where;
    };
    strictEqual(parseCondition(nested(31)).ok, true);
    deepStrictEqual(error(nested(32)).code, 'tooDeep');
    strictEqual(parseCondition(nested(1), { maxDepth: 2 }).ok, true);
    strictEqual(error(nested(2), { maxDepth: 2 }).code, 'tooDeep');
  });

  it('survives depth bombs without overflowing', () => {
    let and: unknown = { a: 1 };
    let not: unknown = { a: 1 };
    for (let i = 0; i < 10_000; i++) {
      and = { and: [and] };
      not = { not: not };
    }
    strictEqual(error(and).code, 'tooDeep');
    strictEqual(error(not).code, 'tooDeep');
  });
});
