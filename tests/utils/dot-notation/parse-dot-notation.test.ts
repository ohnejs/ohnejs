import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseDotNotation, segmentAddresses } from '../../../src/utils/index.ts';

describe('parseDotNotation', () => {
  it('parses a single key', () => {
    deepStrictEqual(parseDotNotation('foo'), [{ kind: 'key', value: 'foo' }]);
  });

  it('parses dotted keys', () => {
    deepStrictEqual(parseDotNotation('foo.bar.baz'), [
      { kind: 'key', value: 'foo' },
      { kind: 'key', value: 'bar' },
      { kind: 'key', value: 'baz' },
    ]);
  });

  it('parses a single bracket index', () => {
    deepStrictEqual(parseDotNotation('[0]'), [{ kind: 'index', value: 0 }]);
  });

  it('parses chained bracket indices', () => {
    deepStrictEqual(parseDotNotation('[0][1][2]'), [
      { kind: 'index', value: 0 },
      { kind: 'index', value: 1 },
      { kind: 'index', value: 2 },
    ]);
  });

  it('parses mixed keys and indices', () => {
    deepStrictEqual(parseDotNotation('foo.bar[0].baz[1]'), [
      { kind: 'key', value: 'foo' },
      { kind: 'key', value: 'bar' },
      { kind: 'index', value: 0 },
      { kind: 'key', value: 'baz' },
      { kind: 'index', value: 1 },
    ]);
  });

  it('parses a leading bracket followed by a dotted key', () => {
    deepStrictEqual(parseDotNotation('[0].foo'), [
      { kind: 'index', value: 0 },
      { kind: 'key', value: 'foo' },
    ]);
  });

  it('accepts keys with spaces and special chars that are not "." or "[" or "]"', () => {
    deepStrictEqual(parseDotNotation('hello world'), [{ kind: 'key', value: 'hello world' }]);
    deepStrictEqual(parseDotNotation('a-b_c$d'), [{ kind: 'key', value: 'a-b_c$d' }]);
  });

  it('throws on empty path', () => {
    throws(() => parseDotNotation(''), /empty/);
  });

  it('throws on leading dot', () => {
    throws(() => parseDotNotation('.foo'), /leading "\."/);
  });

  it('throws on trailing dot', () => {
    throws(() => parseDotNotation('foo.'), /trailing "\."/);
  });

  it('throws on doubled dots', () => {
    throws(() => parseDotNotation('foo..bar'), /empty key/);
  });

  it('throws on unterminated bracket', () => {
    throws(() => parseDotNotation('foo[0'), /unterminated/);
  });

  it('throws on unmatched closing bracket', () => {
    throws(() => parseDotNotation('foo]'), /unmatched/);
  });

  it('throws on non-numeric index', () => {
    throws(() => parseDotNotation('foo[abc]'), /not a non-negative integer/);
  });

  it('throws on negative index', () => {
    throws(() => parseDotNotation('foo[-1]'), /not a non-negative integer/);
  });

  it('throws on leading-zero index', () => {
    throws(() => parseDotNotation('foo[01]'), /not a non-negative integer/);
  });

  it('throws on empty brackets', () => {
    throws(() => parseDotNotation('foo[]'), /not a non-negative integer/);
  });

  it('throws on whitespace inside brackets', () => {
    throws(() => parseDotNotation('foo[ 0 ]'), /not a non-negative integer/);
  });

  it('throws on hex index', () => {
    throws(() => parseDotNotation('foo[0x10]'), /not a non-negative integer/);
  });

  it('throws on exponent index', () => {
    throws(() => parseDotNotation('foo[1e3]'), /not a non-negative integer/);
  });

  it('throws on unsafe-integer index', () => {
    throws(() => parseDotNotation('foo[99999999999999999999]'), /not a non-negative integer/);
  });

  it('throws when a key follows an index without a separator', () => {
    throws(() => parseDotNotation('foo[0]bar'), /expected "\." or "\["/);
  });
});

describe('segmentAddresses', () => {
  it('key segments address plain objects only', () => {
    strictEqual(segmentAddresses({ kind: 'key', value: 'a' }, { a: 1 }), true);
    strictEqual(segmentAddresses({ kind: 'key', value: 'a' }, [1, 2]), false);
    strictEqual(segmentAddresses({ kind: 'key', value: 'a' }, new Map()), false);
  });

  it('index segments address arrays only', () => {
    strictEqual(segmentAddresses({ kind: 'index', value: 0 }, [1, 2]), true);
    strictEqual(segmentAddresses({ kind: 'index', value: 0 }, { 0: 'x' }), false);
  });
});
