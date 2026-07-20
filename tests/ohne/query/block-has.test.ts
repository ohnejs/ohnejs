import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { splitBlockHas } from '../../../src/ohne/query/block-has.ts';
import { parseCondition, type ConditionNode } from '../../../src/utils/index.ts';

function conditionOf(where: Record<string, unknown>): ConditionNode {
  const result = parseCondition(where);
  ok(result.ok);
  return result.node;
}

describe('splitBlockHas', () => {
  it('takes the root node itself as the lone discriminator', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: 'VHero' })), {
      ok: true,
      block: 'VHero',
      rest: null,
    });
  });

  it('takes the explicit equalsTo form too', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: { equalsTo: 'VHero' } })), {
      ok: true,
      block: 'VHero',
      rest: null,
    });
  });

  it('leaves a single sibling bare', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: 'VHero', title: 'x' })), {
      ok: true,
      block: 'VHero',
      rest: { kind: 'compare', path: ['title'], op: 'equalsTo', value: 'x', negated: false },
    });
  });

  it('re-wraps several siblings as `and`', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: 'VHero', a: 1, b: 2 })), {
      ok: true,
      block: 'VHero',
      rest: {
        kind: 'and',
        nodes: [
          { kind: 'compare', path: ['a'], op: 'equalsTo', value: 1, negated: false },
          { kind: 'compare', path: ['b'], op: 'equalsTo', value: 2, negated: false },
        ],
      },
    });
  });

  it('matches nothing without a `block` equality', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ title: 'x' })), { ok: false });
  });

  it('refuses a negated discriminator', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ not: { block: 'VHero' } })), { ok: false });
  });

  it('refuses an `in` discriminator', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: { in: ['VHero'] } })), { ok: false });
  });

  it('refuses a discriminator inside an `or`', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ or: [{ block: 'VHero' }, { block: 'VQuote' }] })), {
      ok: false,
    });
  });

  it('refuses a discriminator buried in a nested group', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ and: [{ block: 'VHero', a: 1 }, { b: 2 }] })), {
      ok: false,
    });
  });

  it('refuses a non-string discriminator value', () => {
    deepStrictEqual(splitBlockHas(conditionOf({ block: 5 })), { ok: false });
  });
});
