import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSearchParams, stringifySearchParams } from '../../../src/utils/index.ts';

describe('stringifySearchParams', () => {
  it('serializes scalars with their type', () => {
    strictEqual(
      stringifySearchParams({ n: 42, b: true, x: null, s: 'hi' }),
      'n=42&b=true&x=null&s=hi',
    );
  });

  it('serializes arrays and objects, nested', () => {
    strictEqual(stringifySearchParams({ a: [1, 'two', true] }), 'a=[1,two,true]');
    strictEqual(stringifySearchParams({ p: { x: 1, y: 'hi' } }), 'p={x:1,y:hi}');
    strictEqual(stringifySearchParams({ a: [{ id: 1 }, { id: 2 }] }), 'a=[{id:1},{id:2}]');
  });

  it('marks strings that would read back as another type', () => {
    strictEqual(stringifySearchParams({ a: '1', b: 'true', c: 'null' }), 'a=`1&b=`true&c=`null');
    strictEqual(stringifySearchParams({ a: '`x' }), 'a=``x');
  });

  it('leaves real numbers and unsafe-int strings unmarked', () => {
    strictEqual(
      stringifySearchParams({ a: '007', b: '9007199254740993' }),
      'a=007&b=9007199254740993',
    );
  });

  it('percent-encodes only the characters that need it', () => {
    strictEqual(stringifySearchParams({ s: 'a,b' }), 's=a%2Cb');
    strictEqual(stringifySearchParams({ s: '[x]' }), 's=%5Bx%5D');
    strictEqual(stringifySearchParams({ s: 'a b&c' }), 's=a%20b%26c');
    strictEqual(stringifySearchParams({ s: "it's" }), 's=it%27s');
  });

  it('keeps operators and structure readable', () => {
    strictEqual(stringifySearchParams({ f: [['a', '!=', 1]] }), 'f=[[a,!=,1]]');
  });

  it('round-trips empty-string array elements', () => {
    strictEqual(stringifySearchParams({ a: [''] }), 'a=[`]');
    deepStrictEqual(parseSearchParams('a=[`]'), { a: [''] });
    deepStrictEqual(parseSearchParams(stringifySearchParams({ a: ['', ''] })), { a: ['', ''] });
  });

  it('drops keys whose value is undefined', () => {
    strictEqual(stringifySearchParams({ a: 1, b: undefined, c: 3 }), 'a=1&c=3');
  });

  it('writes non-finite numbers as null', () => {
    strictEqual(stringifySearchParams({ a: Infinity, b: NaN }), 'a=null&b=null');
  });

  it('encodes = and & in keys', () => {
    strictEqual(stringifySearchParams({ 'a=b': 1, 'c&d': 2 }), 'a%3Db=1&c%26d=2');
  });

  it('round-trips a first key that starts with ?', () => {
    deepStrictEqual(parseSearchParams(stringifySearchParams({ '?a': 1 })), { '?a': 1 });
  });

  it('writes a lone surrogate as U+FFFD instead of throwing', () => {
    strictEqual(stringifySearchParams({ 'k\uD800': 'v\uDC00' }), 'k%EF%BF%BD=v%EF%BF%BD');
  });

  it('round-trips any JSON value', () => {
    const value = {
      title: 'red & blue',
      tags: ['new', 'sale'],
      price: 19.9,
      stock: 1500,
      id: '9007199254740993',
      meta: { featured: true, note: 'size 42', empty: [] },
      flags: [true, false, null],
    };
    deepStrictEqual(parseSearchParams(stringifySearchParams(value)), value);
  });

  it('round-trips an integer above the safe range as a number', () => {
    for (const n of [1e20, 2 ** 53, 9007199254740994]) {
      const back = parseSearchParams(stringifySearchParams({ n })).n;
      strictEqual(back, n);
      strictEqual(typeof back, 'number');
    }
  });
});
