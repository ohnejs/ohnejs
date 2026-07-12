import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSearchParams } from '../../../src/utils/index.ts';

describe('parseSearchParams', () => {
  it('coerces scalars to their JSON type', () => {
    deepStrictEqual(parseSearchParams('n=42&f=1.5&e=2e3'), { n: 42, f: 1.5, e: 2000 });
    deepStrictEqual(parseSearchParams('a=true&b=false&c=null'), { a: true, b: false, c: null });
    deepStrictEqual(parseSearchParams('s=ohne'), { s: 'ohne' });
  });

  it('keeps non-canonical numbers as strings', () => {
    deepStrictEqual(parseSearchParams('zip=007&plus=+5&frac=.5'), {
      zip: '007',
      plus: '+5',
      frac: '.5',
    });
  });

  it('keeps integers past the safe range as strings', () => {
    deepStrictEqual(parseSearchParams('id=9007199254740993'), { id: '9007199254740993' });
  });

  it('reads a backtick as a forced string', () => {
    deepStrictEqual(parseSearchParams('a=`1&b=`true&c=`null'), { a: '1', b: 'true', c: 'null' });
  });

  it('treats an empty value as an empty string and a bare key as true', () => {
    deepStrictEqual(parseSearchParams('a=&b'), { a: '', b: true });
  });

  it('parses arrays, including nested, empty, and mixed', () => {
    deepStrictEqual(parseSearchParams('a=[1,2,3]'), { a: [1, 2, 3] });
    deepStrictEqual(parseSearchParams('a=[]'), { a: [] });
    deepStrictEqual(parseSearchParams('a=[1,hi,true,null]'), { a: [1, 'hi', true, null] });
    deepStrictEqual(parseSearchParams('a=[[1,2],[3,4]]'), {
      a: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it('parses objects, including nested and empty', () => {
    deepStrictEqual(parseSearchParams('p={x:1,y:hi}'), { p: { x: 1, y: 'hi' } });
    deepStrictEqual(parseSearchParams('p={}'), { p: {} });
    deepStrictEqual(parseSearchParams('p={a:{b:2}}'), { p: { a: { b: 2 } } });
    deepStrictEqual(parseSearchParams('p=[{id:1},{id:2}]'), { p: [{ id: 1 }, { id: 2 }] });
  });

  it('decodes percent-encoded structural and transport characters in leaves', () => {
    deepStrictEqual(parseSearchParams('s=a%2Cb'), { s: 'a,b' });
    deepStrictEqual(parseSearchParams('s=%5B1%5D'), { s: '[1]' });
    deepStrictEqual(parseSearchParams('q=a%20b&amp=x%26y'), { q: 'a b', amp: 'x&y' });
  });

  it('collects a repeated key into an array', () => {
    deepStrictEqual(parseSearchParams('t=1&t=2&t=3'), { t: [1, 2, 3] });
    deepStrictEqual(parseSearchParams('t=[1]&t=2'), { t: [[1], 2] });
  });

  it('strips a leading ? or #', () => {
    deepStrictEqual(parseSearchParams('?a=1'), { a: 1 });
    deepStrictEqual(parseSearchParams('#a=1'), { a: 1 });
    deepStrictEqual(parseSearchParams(''), {});
  });

  it('falls back to the decoded string on malformed structure', () => {
    deepStrictEqual(parseSearchParams('a=[1,2'), { a: '[1,2' });
    deepStrictEqual(parseSearchParams('a={x:1'), { a: '{x:1' });
    deepStrictEqual(parseSearchParams('a=[1,2]x'), { a: '[1,2]x' });
  });

  it('parses structure nested to exactly the depth cap', () => {
    let expected: unknown = 1;
    for (let i = 0; i < 32; i++) expected = { a: expected };
    deepStrictEqual(parseSearchParams('a=' + '{a:'.repeat(32) + '1' + '}'.repeat(32)), {
      a: expected,
    });

    let list: unknown = 1;
    for (let i = 0; i < 32; i++) list = [list];
    deepStrictEqual(parseSearchParams('a=' + '['.repeat(32) + '1' + ']'.repeat(32)), { a: list });
  });

  it('degrades a subtree one past the depth cap to its raw text', () => {
    let expected: unknown = '{a:1}';
    for (let i = 0; i < 32; i++) expected = { a: expected };
    deepStrictEqual(parseSearchParams('a=' + '{a:'.repeat(33) + '1' + '}'.repeat(33)), {
      a: expected,
    });

    let list: unknown = '[1]';
    for (let i = 0; i < 32; i++) list = [list];
    deepStrictEqual(parseSearchParams('a=' + '['.repeat(33) + '1' + ']'.repeat(33)), { a: list });
  });

  it('honors a custom maxDepth, degrading structures past it to text', () => {
    deepStrictEqual(parseSearchParams('a={b:{c:1}}', { maxDepth: 1 }), { a: { b: '{c:1}' } });
    deepStrictEqual(parseSearchParams('a={b:1}', { maxDepth: 0 }), { a: '{b:1}' });
    deepStrictEqual(parseSearchParams('a={b:{c:1}}'), { a: { b: { c: 1 } } });
  });

  it('caps a 100k-deep bomb to a structure instead of overflowing the stack', () => {
    // Without the cap the recursion overflows and the catch-all returns the raw string;
    // capped, the outer levels parse and the tail past the cap degrades to flat text.
    const objectBomb = 'a=' + '{a:'.repeat(100_000) + '1' + '}'.repeat(100_000);
    strictEqual(typeof parseSearchParams(objectBomb).a, 'object');

    const arrayBomb = 'a=' + '['.repeat(100_000) + '1' + ']'.repeat(100_000);
    strictEqual(Array.isArray(parseSearchParams(arrayBomb).a), true);
  });

  it('stores a __proto__ key as an own property without polluting', () => {
    const result = parseSearchParams('__proto__={polluted:1}');
    strictEqual(Object.hasOwn(result, '__proto__'), true);
    deepStrictEqual(result['__proto__'], { polluted: 1 });
    strictEqual(Object.getPrototypeOf(result), Object.prototype);

    const nested = parseSearchParams('o={__proto__:{polluted:1}}');
    strictEqual(Object.getPrototypeOf(nested['o']), Object.prototype);
  });
});
