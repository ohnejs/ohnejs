import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ConditionNode } from '../../../src/utils/condition/operators.ts';

import { evaluateCondition } from '../../../src/utils/condition/evaluate-condition.ts';
import { parseCondition } from '../../../src/utils/condition/parse-condition.ts';

function run(where: unknown, record: Record<string, unknown>): boolean {
  const parsed = parseCondition(where);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return evaluateCondition(parsed.node, ([first]) => record[first]);
}

describe('evaluateCondition', () => {
  it('equalsTo compares strictly', () => {
    strictEqual(run({ v: 1 }, { v: 1 }), true);
    strictEqual(run({ v: 1 }, { v: '1' }), false);
    strictEqual(run({ v: { not: { equalsTo: 1 } } }, { v: 2 }), true);
  });

  it('in tests membership', () => {
    strictEqual(run({ v: { in: [1, 2] } }, { v: 2 }), true);
    strictEqual(run({ v: { in: [1, 2] } }, { v: 3 }), false);
    strictEqual(run({ v: { in: [] } }, { v: 1 }), false);
  });

  it('orders numbers', () => {
    strictEqual(run({ v: { atLeast: 5 } }, { v: 5 }), true);
    strictEqual(run({ v: { atLeast: 5 } }, { v: 4 }), false);
    strictEqual(run({ v: { greaterThan: 5 } }, { v: 5 }), false);
    strictEqual(run({ v: { lessThan: 5 } }, { v: 4 }), true);
    strictEqual(run({ v: { atMost: 5 } }, { v: 6 }), false);
  });

  it('orders strings lexicographically', () => {
    strictEqual(run({ v: { greaterThan: 'a' } }, { v: 'b' }), true);
    strictEqual(run({ v: { lessThan: 'a' } }, { v: 'b' }), false);
  });

  it('ordering over mixed types is false', () => {
    strictEqual(run({ v: { atLeast: 5 } }, { v: '5' }), false);
    strictEqual(run({ v: { atLeast: 'a' } }, { v: 5 }), false);
    strictEqual(run({ v: { atLeast: 5 } }, { v: NaN }), false);
  });

  it('matches the text trio case-insensitively', () => {
    strictEqual(run({ v: { contains: 'HN' } }, { v: 'ohne' }), true);
    strictEqual(run({ v: { startsWith: 'OH' } }, { v: 'ohne' }), true);
    strictEqual(run({ v: { endsWith: 'NE' } }, { v: 'ohne' }), true);
    strictEqual(run({ v: { contains: 'x' } }, { v: 'ohne' }), false);
    strictEqual(run({ v: { contains: 'oh' } }, { v: 5 }), false);
  });

  it('like matches % as any run and _ as one character', () => {
    strictEqual(run({ v: { like: 'a%' } }, { v: 'abc' }), true);
    strictEqual(run({ v: { like: '%ne' } }, { v: 'ohne' }), true);
    strictEqual(run({ v: { like: 'a_c' } }, { v: 'abc' }), true);
    strictEqual(run({ v: { like: 'a_c' } }, { v: 'abbc' }), false);
    strictEqual(run({ v: { like: 'A%' } }, { v: 'abc' }), true);
    strictEqual(run({ v: { like: 'a%c' } }, { v: 'a\nc' }), true);
  });

  it('like escapes regex metacharacters', () => {
    strictEqual(run({ v: { like: 'a.c' } }, { v: 'abc' }), false);
    strictEqual(run({ v: { like: 'a.c' } }, { v: 'a.c' }), true);
    strictEqual(run({ v: { like: '(x)%' } }, { v: '(x)!' }), true);
  });

  it('like treats a pattern % as a wildcard even over a literal %', () => {
    strictEqual(run({ v: { like: '%' } }, { v: '%x' }), true);
    strictEqual(run({ v: { like: '%%%' } }, { v: 'a%b' }), true);
    strictEqual(run({ v: { like: '100% d%' } }, { v: '100% done' }), true);
  });

  it('like folds case after splitting, so _ consumes one original code point', () => {
    strictEqual(run({ v: { like: '_stanbul' } }, { v: 'İstanbul' }), true);
    strictEqual(run({ v: { like: '_x' } }, { v: '😀x' }), true);
  });

  it('like never flickers across repeated evaluations', () => {
    const parsed = parseCondition({ v: { like: 'a%' } });
    if (!parsed.ok) throw new Error('parse failed');
    for (let i = 0; i < 4; i++) {
      strictEqual(
        evaluateCondition(parsed.node, () => 'abc'),
        true,
        `evaluation ${i} flickered`,
      );
    }
  });

  it('a compare over a nullish value is false even negated, as SQL drops the row', () => {
    strictEqual(run({ v: { not: { equalsTo: 1 } } }, { v: null }), false);
    strictEqual(run({ v: { not: { contains: 'x' } } }, {}), false);
    strictEqual(run({ v: { not: { in: [1, 2] } } }, { v: null }), false);
    strictEqual(run({ v: { not: { atLeast: 5 } } }, { v: null }), false);
    strictEqual(run({ v: { not: { isNull: true } } }, { v: null }), false);
  });

  it('isNull tests null exactly', () => {
    strictEqual(run({ v: { isNull: true } }, { v: null }), true);
    strictEqual(run({ v: { isNull: true } }, {}), false);
    strictEqual(run({ v: { isNull: true } }, { v: 0 }), false);
    strictEqual(run({ v: { not: { isNull: true } } }, { v: 0 }), true);
  });

  it('includes tests array membership', () => {
    strictEqual(run({ v: { includes: 'a' } }, { v: ['a', 'b'] }), true);
    strictEqual(run({ v: { includes: 'c' } }, { v: ['a', 'b'] }), false);
    strictEqual(run({ v: { includes: 'a' } }, { v: 'a' }), false);
  });

  it('includesAll and includesAny apply set logic', () => {
    strictEqual(run({ v: { includesAll: ['a', 'b'] } }, { v: ['a', 'b', 'c'] }), true);
    strictEqual(run({ v: { includesAll: ['a', 'd'] } }, { v: ['a', 'b'] }), false);
    strictEqual(run({ v: { includesAll: [] } }, { v: ['a'] }), true);
    strictEqual(run({ v: { includesAny: ['x', 'b'] } }, { v: ['a', 'b'] }), true);
    strictEqual(run({ v: { includesAny: [] } }, { v: ['a'] }), false);
    strictEqual(run({ v: { includesAny: ['a'] } }, { v: 'a' }), false);
  });

  it('bare has wants a non-null, non-empty value', () => {
    strictEqual(run({ v: { has: true } }, { v: null }), false);
    strictEqual(run({ v: { has: true } }, {}), false);
    strictEqual(run({ v: { has: true } }, { v: [] }), false);
    strictEqual(run({ v: { has: true } }, { v: [1] }), true);
    strictEqual(run({ v: { has: true } }, { v: {} }), true);
    strictEqual(run({ v: { has: true } }, { v: 5 }), true);
  });

  it('nested has matches some array item', () => {
    const items = [{ name: 'Alice' }, { name: 'Bob' }];
    strictEqual(run({ v: { has: { name: 'Bob' } } }, { v: items }), true);
    strictEqual(run({ v: { has: { name: 'Carol' } } }, { v: items }), false);
    strictEqual(run({ v: { not: { has: { name: 'Carol' } } } }, { v: items }), true);
  });

  it('nested has evaluates a non-null object directly', () => {
    strictEqual(run({ v: { has: { name: 'Alice' } } }, { v: { name: 'Alice' } }), true);
    strictEqual(run({ v: { has: { name: 'Alice' } } }, { v: 5 }), false);
    strictEqual(run({ v: { has: { name: 'Alice' } } }, { v: null }), false);
  });

  it('nested has paths descend by plain own properties', () => {
    const items = [{ address: { city: 'Vienna' } }];
    strictEqual(run({ v: { has: { 'address.city': 'Vienna' } } }, { v: items }), true);
    strictEqual(run({ v: { has: { 'address.city': 'Graz' } } }, { v: items }), false);
    strictEqual(run({ v: { has: { 'address.toString': { has: true } } } }, { v: items }), false);
  });

  it('empty tests array length and null', () => {
    strictEqual(run({ v: { empty: true } }, { v: [] }), true);
    strictEqual(run({ v: { empty: true } }, { v: [1] }), false);
    strictEqual(run({ v: { empty: true } }, { v: null }), true);
    strictEqual(run({ v: { empty: true } }, { v: 'x' }), false);
    strictEqual(run({ v: { empty: true } }, {}), false);
    strictEqual(run({ v: { not: { empty: true } } }, { v: [1] }), true);
  });

  it('and over no nodes is true, or over none false', () => {
    strictEqual(run({}, {}), true);
    strictEqual(run({ or: [] }, {}), false);
  });

  it('combines groups', () => {
    const record = { status: 'published', views: 120, featured: false };
    strictEqual(run({ status: 'published', views: { atLeast: 100 } }, record), true);
    strictEqual(
      run({ status: 'published', or: [{ featured: true }, { views: { atLeast: 100 } }] }, record),
      true,
    );
    strictEqual(
      run({ status: 'published', or: [{ featured: true }, { views: { atLeast: 200 } }] }, record),
      false,
    );
    strictEqual(run({ views: { atLeast: 200, or: [{ equalsTo: 120 }] } }, record), true);
  });

  it('stays inert on hand-built misuse', () => {
    const bad: ConditionNode = { kind: 'compare', path: ['v'], op: 'in', value: 5, negated: false };
    strictEqual(
      evaluateCondition(bad, () => 5),
      false,
    );
    const flipped: ConditionNode = { ...bad, negated: true };
    strictEqual(
      evaluateCondition(flipped, () => 5),
      true,
    );
  });

  it('negation flips an inert comparison', () => {
    strictEqual(run({ v: { not: { contains: 'x' } } }, { v: 5 }), true);
  });
});
