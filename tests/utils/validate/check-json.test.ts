import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkJSON, jsonDepthWithin } from '../../../src/utils/index.ts';

/**
 * An array nested `depth` levels deep around `1`.
 */
function nested(depth: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < depth; level++) value = [value];
  return value;
}

describe('checkJSON', () => {
  it('accepts plain JSON data', () => {
    strictEqual(checkJSON(null), undefined);
    strictEqual(checkJSON('Thrall'), undefined);
    strictEqual(checkJSON({ tags: ['a', 'b'], max: 3, meta: { deep: null } }), undefined);
    strictEqual(checkJSON(Object.assign(Object.create(null), { a: 1 })), undefined);
  });

  it('names anything JSON would drop or distort invalid JSON', () => {
    strictEqual(checkJSON(NaN), 'validation.invalidJSON');
    strictEqual(checkJSON([Infinity]), 'validation.invalidJSON');
    strictEqual(checkJSON({ at: new Date() }), 'validation.invalidJSON');
    strictEqual(checkJSON({ a: undefined }), 'validation.invalidJSON');
    strictEqual(checkJSON(Object.assign([], { 1: 1 })), 'validation.invalidJSON');
    strictEqual(checkJSON(Object.assign([1], { extra: 2 })), 'validation.invalidJSON');
    strictEqual(checkJSON({ [Symbol('x')]: 1 }), 'validation.invalidJSON');
  });

  it('allows 32 levels by default and refuses the 33rd', () => {
    strictEqual(checkJSON(nested(32)), undefined);
    deepStrictEqual(checkJSON(nested(33)), { key: 'validation.maxDepth', params: { max: 32 } });
  });

  it('honours an explicit `maxDepth`', () => {
    strictEqual(checkJSON(1, { maxDepth: 0 }), undefined);
    deepStrictEqual(checkJSON([], { maxDepth: 0 }), {
      key: 'validation.maxDepth',
      params: { max: 0 },
    });
    strictEqual(checkJSON(nested(40), { maxDepth: 40 }), undefined);
  });

  it('counts depth as `jsonDepthWithin` does', () => {
    const samples: unknown[] = [1, [], {}, [[]], { a: [{ b: [] }] }, nested(5), [1, [2, [3]]]];
    for (const value of samples) {
      for (let max = 0; max <= 6; max++) {
        strictEqual(
          checkJSON(value, { maxDepth: max }) === undefined,
          jsonDepthWithin(JSON.stringify(value), max),
          `${JSON.stringify(value)} at ${max}`,
        );
      }
    }
  });

  it('walks a cycle or a very deep value without throwing', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    deepStrictEqual(checkJSON(cycle), { key: 'validation.maxDepth', params: { max: 32 } });
    deepStrictEqual(checkJSON(nested(100_000), { maxDepth: 1e6 }), undefined);
    deepStrictEqual(checkJSON(cycle, { maxDepth: 1e5 }), {
      key: 'validation.maxDepth',
      params: { max: 1e5 },
    });
  });
});
