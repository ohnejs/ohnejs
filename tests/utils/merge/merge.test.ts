import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { merge } from '../../../src/utils/index.ts';

describe('merge', () => {
  it('merges two flat objects with source winning on conflicts', () => {
    deepStrictEqual(merge({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
  });

  it('accepts different types for target and source', () => {
    const result = merge({ a: 1 }, { b: 'two' });
    deepStrictEqual(result, { a: 1, b: 'two' });
    const _typed: { a: number } & { b: string } = result;
    void _typed;
  });

  it('recurses into nested plain objects', () => {
    deepStrictEqual(merge({ a: { x: 1, y: 2 } }, { a: { y: 9, z: 3 } }), {
      a: { x: 1, y: 9, z: 3 },
    });
  });

  it('concatenates two arrays at the top level', () => {
    deepStrictEqual(merge([1, 2], [2, 3]), [1, 2, 2, 3]);
  });

  it('dedupes the concatenated array when `dedupe` is true', () => {
    deepStrictEqual(merge([1, 2], [2, 3], { dedupe: true }), [1, 2, 3]);
  });

  it('concatenates nested arrays inside objects', () => {
    deepStrictEqual(merge({ tags: ['a', 'b'] }, { tags: ['b', 'c'] }), {
      tags: ['a', 'b', 'b', 'c'],
    });
  });

  it('applies `dedupe` to nested arrays, not just the top level', () => {
    deepStrictEqual(
      merge({ a: { tags: ['x', 'y'] } }, { a: { tags: ['y', 'z'] } }, { dedupe: true }),
      { a: { tags: ['x', 'y', 'z'] } },
    );
  });

  it('unions two Sets at the top level', () => {
    deepStrictEqual(merge(new Set([1, 2]), new Set([2, 3])), new Set([1, 2, 3]));
  });

  it('unions nested Sets inside objects', () => {
    deepStrictEqual(merge({ s: new Set([1, 2]) }, { s: new Set([2, 3]) }), {
      s: new Set([1, 2, 3]),
    });
  });

  it('merges two Maps with source winning per key by default', () => {
    deepStrictEqual(
      merge(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
        new Map([
          ['b', 99],
          ['c', 3],
        ]),
      ),
      new Map([
        ['a', 1],
        ['b', 99],
        ['c', 3],
      ]),
    );
  });

  it('recursively merges Map values on shared keys when `deep` is true', () => {
    const target = new Map<string, Record<string, number>>([['k', { a: 1, b: 2 }]]);
    const source = new Map<string, Record<string, number>>([['k', { b: 9, c: 3 }]]);
    deepStrictEqual(merge(target, source, { deep: true }), new Map([['k', { a: 1, b: 9, c: 3 }]]));
  });

  it('without `deep`, Map values are replaced wholesale even when both are objects', () => {
    const target = new Map<string, Record<string, number>>([['k', { a: 1 }]]);
    const source = new Map<string, Record<string, number>>([['k', { b: 2 }]]);
    deepStrictEqual(merge(target, source), new Map([['k', { b: 2 }]]));
  });

  it('replaces non-plain, non-collection values (Date, RegExp) wholesale', () => {
    const d2 = new Date(1000);
    deepStrictEqual(merge({ at: new Date(0) }, { at: d2 }), { at: d2 });

    const r2 = /bar/;
    deepStrictEqual(merge({ p: /foo/ }, { p: r2 }), { p: r2 });
  });

  it('returns target when source is undefined', () => {
    const target = { a: 1 };
    strictEqual(merge(target, undefined), target);
  });

  it('returns source when target is undefined', () => {
    const source = { a: 1 };
    strictEqual(merge(undefined, source), source);
  });

  it('skips undefined values inside a source object instead of erasing target keys', () => {
    type ABC = { a?: number; b?: number; c?: number };
    const target: ABC = { a: 1, b: 2 };
    const source: ABC = { b: undefined, c: 3 };
    deepStrictEqual(merge(target, source), { a: 1, b: 2, c: 3 });
  });

  it('lets a non-object source replace an object target', () => {
    strictEqual(merge({ a: 1 }, null), null);
    strictEqual(merge({ a: 1 }, 42), 42);
  });

  it('lets an object source replace a non-object target', () => {
    const source = { a: 1 };
    strictEqual(merge(null, source), source);
    strictEqual(merge(42, source), source);
  });

  it('replaces wholesale when target and source are mismatched collection kinds', () => {
    const source = new Set([3]);
    strictEqual(merge([1, 2], source), source);

    const map = new Map([['k', 1]]);
    strictEqual(merge([1], map), map);
  });

  it('does not mutate either input', () => {
    const target = { a: { x: 1 }, tags: [1, 2], s: new Set([1]), m: new Map([['k', 1]]) };
    const source = { a: { x: 2 }, tags: [3], s: new Set([2]), m: new Map([['k', 2]]) };
    const targetSnapshot = structuredClone(target);
    const sourceSnapshot = structuredClone(source);

    merge(target, source);

    deepStrictEqual(target, targetSnapshot);
    deepStrictEqual(source, sourceSnapshot);
  });

  it('replaces a plain-object value with a non-plain value', () => {
    deepStrictEqual(merge({ a: { nested: true } as object }, { a: ['array', 'wins'] }), {
      a: ['array', 'wins'],
    });
  });

  it('does not let a "__proto__" key in source rewrite the result\'s prototype', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = merge({ foo: 1 }, malicious) as Record<string, unknown>;

    strictEqual(Object.getPrototypeOf(result), Object.prototype);
    strictEqual((result as { polluted?: unknown }).polluted, undefined);
    strictEqual('polluted' in result, false);
  });

  it('drops "constructor" and "prototype" keys from source rather than overwriting them', () => {
    const malicious = JSON.parse(
      '{"constructor": {"prototype": {"polluted": true}}, "prototype": {"polluted": true}}',
    );
    const result = merge({ foo: 1 }, malicious) as Record<string, unknown>;

    deepStrictEqual(result, { foo: 1 });
    strictEqual(result.constructor, Object);
    strictEqual((result as { prototype?: unknown }).prototype, undefined);
  });

  it('drops "__proto__" at any nesting depth, not just at the top level', () => {
    const malicious = JSON.parse('{"a": {"__proto__": {"polluted": true}}}');
    const result = merge({ a: { foo: 1 } }, malicious) as { a: Record<string, unknown> };

    strictEqual(Object.getPrototypeOf(result.a), Object.prototype);
    strictEqual((result.a as { polluted?: unknown }).polluted, undefined);
    strictEqual('polluted' in result.a, false);
  });
});
