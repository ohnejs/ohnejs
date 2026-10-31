import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeBase32, encodeBase32 } from '../../../src/utils/index.ts';

const decode = (text: string) => new TextDecoder().decode(decodeBase32(text));

describe('decodeBase32', () => {
  it('matches the RFC 4648 vectors, padded and unpadded', () => {
    const vectors = [
      ['', ''],
      ['f', 'MY======'],
      ['fo', 'MZXQ===='],
      ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI======'],
    ];
    for (const [text, encoded] of vectors) {
      deepStrictEqual(decode(encoded!), text);
      deepStrictEqual(decode(encoded!.replace(/=+$/, '')), text);
    }
  });

  it('accepts lowercase and whitespace', () => {
    deepStrictEqual(decode('mzxw 6ytb\noi'), 'foobar');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37));
    deepStrictEqual(decodeBase32(encodeBase32(bytes)), bytes);
  });

  it('throws on a character outside the alphabet', () => {
    throws(() => decodeBase32('MZXW1'), /Invalid base32 character `1`/);
    throws(() => decodeBase32('MZ=XW'), /Invalid base32 character `=`/);
    throws(() => decodeBase32('MſXW'), /Invalid base32 character `ſ`/);
  });

  it('throws on a length no encoding produces', () => {
    throws(() => decodeBase32('M'), /Invalid base32 length `1`/);
    throws(() => decodeBase32('MZX'), /Invalid base32 length `3`/);
    throws(() => decodeBase32('MZXW6Y'), /Invalid base32 length `6`/);
  });
});
