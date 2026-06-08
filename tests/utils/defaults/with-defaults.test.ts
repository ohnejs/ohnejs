import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { withDefaults } from '../../../src/utils/index.ts';

describe('withDefaults', () => {
  it('fills missing keys from defaults; input wins on conflicts', () => {
    deepStrictEqual(withDefaults({ a: 1 }, { a: 2, b: 3 }), { a: 1, b: 3 });
  });

  it('recurses into nested plain objects, input wins per leaf', () => {
    deepStrictEqual(withDefaults({ a: { x: 1 } }, { a: { x: 9, y: 2 } }), {
      a: { x: 1, y: 2 },
    });
  });

  it('replaces arrays wholesale by default; defaults are discarded', () => {
    deepStrictEqual(withDefaults({ tags: ['x'] }, { tags: ['y', 'z'] }), { tags: ['x'] });
  });

  it('uses defaults array when input has no value at all', () => {
    deepStrictEqual(withDefaults({} as { tags?: string[] }, { tags: ['y', 'z'] }), {
      tags: ['y', 'z'],
    });
  });

  it('does not auto-descend into arrays just because a child path is targeted', () => {
    deepStrictEqual(
      withDefaults(
        { items: [{ name: 'A' }] },
        { items: [{ kind: 'x' }, { kind: 'y' }] },
        { strategies: { 'items[0].kind': 'replace' } },
      ),
      { items: [{ name: 'A' }] },
    );
  });

  describe("strategy 'replace'", () => {
    it('forces input to win for a plain object that would otherwise recurse', () => {
      deepStrictEqual(
        withDefaults({ a: { x: 1 } }, { a: { x: 9, y: 2 } }, { strategies: { a: 'replace' } }),
        { a: { x: 1 } },
      );
    });

    it('still falls back to defaults when input is undefined at that path', () => {
      deepStrictEqual(
        withDefaults(
          {} as { a?: { x: number } },
          { a: { x: 1 } },
          { strategies: { a: 'replace' } },
        ),
        { a: { x: 1 } },
      );
    });
  });

  describe("strategy 'concat'", () => {
    it('concatenates input then defaults', () => {
      deepStrictEqual(
        withDefaults({ tags: ['x'] }, { tags: ['y', 'z'] }, { strategies: { tags: 'concat' } }),
        { tags: ['x', 'y', 'z'] },
      );
    });

    it('does not dedupe', () => {
      deepStrictEqual(
        withDefaults(
          { tags: ['x', 'y'] },
          { tags: ['y', 'z'] },
          { strategies: { tags: 'concat' } },
        ),
        { tags: ['x', 'y', 'y', 'z'] },
      );
    });

    it('falls through to default behavior on non-arrays', () => {
      deepStrictEqual(
        withDefaults({ a: { x: 1 } }, { a: { y: 2 } }, { strategies: { a: 'concat' } }),
        { a: { x: 1, y: 2 } },
      );
    });
  });

  describe("strategy 'concat-unique'", () => {
    it('concatenates and dedupes', () => {
      deepStrictEqual(
        withDefaults(
          { tags: ['x', 'y'] },
          { tags: ['y', 'z'] },
          { strategies: { tags: 'concat-unique' } },
        ),
        { tags: ['x', 'y', 'z'] },
      );
    });
  });

  describe("strategy 'defaults'", () => {
    it('recurses into arrays by index, longer side fills the rest', () => {
      deepStrictEqual(
        withDefaults(
          { items: [{ name: 'A' }] },
          { items: [{ kind: 'x' }, { kind: 'y' }] },
          { strategies: { items: 'defaults' } },
        ),
        { items: [{ name: 'A', kind: 'x' }, { kind: 'y' }] },
      );
    });

    it('lets a deeper path override behavior at a specific index', () => {
      deepStrictEqual(
        withDefaults(
          { items: [{ name: 'A' }, { name: 'B' }] },
          { items: [{ kind: 'x' }, { kind: 'y' }] },
          { strategies: { items: 'defaults', 'items[0]': 'replace' } },
        ),
        { items: [{ name: 'A' }, { name: 'B', kind: 'y' }] },
      );
    });

    it('on an object, behaves the same as the default behavior', () => {
      deepStrictEqual(
        withDefaults({ a: { x: 1 } }, { a: { x: 9, y: 2 } }, { strategies: { a: 'defaults' } }),
        { a: { x: 1, y: 2 } },
      );
    });
  });

  describe('path normalisation', () => {
    it('matches paths regardless of leading-dot quirks (canonical form)', () => {
      deepStrictEqual(
        withDefaults({ a: { b: 1 } }, { a: { b: 9 } }, { strategies: { 'a.b': 'replace' } }),
        { a: { b: 1 } },
      );
    });

    it('handles deep array paths (foo[0].bar)', () => {
      deepStrictEqual(
        withDefaults(
          { foo: [{ bar: [1] }] },
          { foo: [{ bar: [2, 3] }] },
          { strategies: { foo: 'defaults', 'foo[0].bar': 'concat' } },
        ),
        { foo: [{ bar: [1, 2, 3] }] },
      );
    });

    it('throws on an invalid strategy key', () => {
      throws(() => withDefaults({}, {}, { strategies: { '.bad': 'replace' } }), /Invalid path/);
    });
  });

  describe('boundary cases', () => {
    it('returns defaults when input is undefined', () => {
      const defaults = { a: 1 };
      strictEqual(withDefaults(undefined, defaults), defaults);
    });

    it('returns input when defaults is undefined', () => {
      const input = { a: 1 };
      strictEqual(withDefaults(input, undefined), input);
    });

    it('skips undefined values inside input so defaults fill those keys', () => {
      type ABC = { a?: number; b?: number; c?: number };
      const input: ABC = { a: 1, b: undefined };
      const defaults: ABC = { b: 2, c: 3 };
      deepStrictEqual(withDefaults(input, defaults), { a: 1, b: 2, c: 3 });
    });

    it('treats non-plain values (Date, RegExp) as leaves and lets input win', () => {
      const inDate = new Date(0);
      deepStrictEqual(withDefaults({ at: inDate }, { at: new Date(1000) }), { at: inDate });

      const inRe = /foo/;
      deepStrictEqual(withDefaults({ p: inRe }, { p: /bar/ }), { p: inRe });
    });

    it('replaces plain object with non-plain input (and vice versa)', () => {
      deepStrictEqual(withDefaults({ a: ['arr'] }, { a: { x: 1 } as object }), { a: ['arr'] });
      deepStrictEqual(withDefaults({ a: { x: 1 } }, { a: ['arr'] as unknown as object }), {
        a: { x: 1 },
      });
    });

    it('does not mutate either input', () => {
      const input = { a: { x: 1 }, tags: [1, 2] };
      const defaults = { a: { x: 9, y: 2 }, tags: [3], extra: true };
      const inSnap = structuredClone(input);
      const defSnap = structuredClone(defaults);

      withDefaults(input, defaults, { strategies: { tags: 'concat' } });

      deepStrictEqual(input, inSnap);
      deepStrictEqual(defaults, defSnap);
    });
  });

  describe('prototype pollution', () => {
    it('does not let "__proto__" in defaults rewrite the result prototype', () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
      const result = withDefaults({ foo: 1 }, malicious) as Record<string, unknown>;

      strictEqual(Object.getPrototypeOf(result), Object.prototype);
      strictEqual('polluted' in result, false);
    });

    it('drops "constructor" and "prototype" from either side', () => {
      const malicious = JSON.parse(
        '{"constructor": {"prototype": {"polluted": true}}, "prototype": {"polluted": true}}',
      );
      const result = withDefaults({ foo: 1 }, malicious) as Record<string, unknown>;

      deepStrictEqual(result, { foo: 1 });
      strictEqual(result.constructor, Object);
    });

    it('drops "__proto__" at nested depth too', () => {
      const malicious = JSON.parse('{"a": {"__proto__": {"polluted": true}}}');
      const result = withDefaults({ a: { foo: 1 } }, malicious) as { a: Record<string, unknown> };

      strictEqual(Object.getPrototypeOf(result.a), Object.prototype);
      strictEqual('polluted' in result.a, false);
    });
  });
});
