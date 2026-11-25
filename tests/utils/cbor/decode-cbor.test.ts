import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeCBOR } from '../../../src/utils/cbor/decode-cbor.ts';

const decode = (hex: string) => decodeCBOR(Uint8Array.fromHex(hex));

describe('decodeCBOR', () => {
  it('decodes the RFC 8949 integer vectors', () => {
    const vectors: [string, number | bigint][] = [
      ['00', 0],
      ['17', 23],
      ['1818', 24],
      ['1864', 100],
      ['1903e8', 1000],
      ['1a000f4240', 1000000],
      ['1b000000e8d4a51000', 1000000000000],
      ['1bffffffffffffffff', 18446744073709551615n],
      ['20', -1],
      ['29', -10],
      ['3863', -100],
      ['3903e7', -1000],
      ['3bffffffffffffffff', -18446744073709551616n],
    ];
    for (const [hex, value] of vectors) strictEqual(decode(hex), value, hex);
  });

  it('returns a bigint exactly when an integer leaves the safe range', () => {
    strictEqual(decode('1b001fffffffffffff'), Number.MAX_SAFE_INTEGER);
    strictEqual(decode('1b0020000000000000'), 9007199254740992n);
    strictEqual(decode('3b001ffffffffffffe'), Number.MIN_SAFE_INTEGER);
    strictEqual(decode('3b001fffffffffffff'), -9007199254740992n);
  });

  it('decodes the RFC 8949 float and simple vectors', () => {
    const vectors: [string, unknown][] = [
      ['f90000', 0],
      ['f98000', -0],
      ['f93c00', 1],
      ['fb3ff199999999999a', 1.1],
      ['f97bff', 65504],
      ['fa47c35000', 100000],
      ['fa7f7fffff', 3.4028234663852886e38],
      ['fb7e37e43c8800759c', 1e300],
      ['f90001', 5.960464477539063e-8],
      ['f9c400', -4],
      ['f97c00', Infinity],
      ['f9fc00', -Infinity],
      ['f97e00', NaN],
      ['f4', false],
      ['f5', true],
      ['f6', null],
      ['f7', undefined],
    ];
    for (const [hex, value] of vectors) strictEqual(decode(hex), value, hex);
  });

  it('decodes the RFC 8949 string vectors', () => {
    deepStrictEqual(decode('40'), new Uint8Array());
    deepStrictEqual(decode('4401020304'), Uint8Array.of(1, 2, 3, 4));
    strictEqual(decode('60'), '');
    strictEqual(decode('6449455446'), 'IETF');
    strictEqual(decode('62225c'), '"\\');
    strictEqual(decode('62c3bc'), 'ü');
    strictEqual(decode('63e6b0b4'), '水');
    strictEqual(decode('64f0908591'), '𐅑');
  });

  it('keeps a leading byte order mark in a text string', () => {
    strictEqual(decode('64efbbbf61'), '\uFEFFa');
  });

  it('decodes the RFC 8949 array and map vectors', () => {
    deepStrictEqual(decode('80'), []);
    deepStrictEqual(decode('8301820203820405'), [1, [2, 3], [4, 5]]);
    deepStrictEqual(
      decode('98190102030405060708090a0b0c0d0e0f101112131415161718181819'),
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    deepStrictEqual(decode('a0'), new Map());
    deepStrictEqual(
      decode('a201020304'),
      new Map([
        [1, 2],
        [3, 4],
      ]),
    );
    deepStrictEqual(
      decode('a26161016162820203'),
      new Map<string, unknown>([
        ['a', 1],
        ['b', [2, 3]],
      ]),
    );
    deepStrictEqual(decode('826161a161626163'), ['a', new Map([['b', 'c']])]);
  });

  it('returns byte strings that do not share the input buffer', () => {
    const input = Uint8Array.fromHex('4401020304');
    const bytes = decodeCBOR(input) as Uint8Array;
    input[1] = 9;
    deepStrictEqual(bytes, Uint8Array.of(1, 2, 3, 4));
  });

  it('rejects indefinite lengths', () => {
    throws(() => decode('5f42010243030405ff'), /indefinite/);
    throws(() => decode('9f018202039f0405ffff'), /indefinite/);
    throws(() => decode('bf61610161629f0203ffff'), /indefinite/);
    throws(() => decode('ff'), /indefinite/);
  });

  it('rejects tags and unassigned simple values', () => {
    throws(() => decode('c11a514b67b0'), /tags/);
    throws(() => decode('f0'), /simple value/);
    throws(() => decode('f8ff'), /simple value/);
    throws(() => decode('1c'), /additional info/);
  });

  it('rejects trailing bytes and truncated data', () => {
    throws(() => decode('0000'), /Trailing/);
    throws(() => decode(''), /ends early/);
    throws(() => decode('1903'), /ends early/);
    throws(() => decode('8301'), /exceeds/);
    throws(() => decode('a20102'), /exceeds/);
  });

  it('rejects a length longer than the data before allocating', () => {
    throws(() => decode('5affffffff00'), /exceeds/);
    throws(() => decode('9bffffffffffffffff'), /exceeds/);
    throws(() => decode('7a0000000561'), /exceeds/);
  });

  it('rejects duplicate keys and keys that are not integers or text', () => {
    throws(() => decode('a201020103'), /Duplicate/);
    throws(() => decode('a1400a'), /keys/);
    throws(() => decode('a1f50a'), /keys/);
    throws(() => decode('a1f93e000a'), /keys/);
  });

  it('rejects malformed UTF-8 in text strings', () => {
    throws(() => decode('61ff'), TypeError);
  });

  it('caps nesting at `maxDepth`', () => {
    const nested = (depth: number) => Uint8Array.fromHex(`${'81'.repeat(depth)}00`);
    deepStrictEqual(decodeCBOR(nested(2)), [[0]]);
    decodeCBOR(nested(16));
    throws(() => decodeCBOR(nested(17)), /deeper/);
    throws(() => decodeCBOR(nested(3), { maxDepth: 2 }), /deeper/);
  });
});
