import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { md5 } from '../../../src/utils/authorization/_md5.ts';

const encoder = new TextEncoder();

describe('md5', () => {
  it('matches the RFC 1321 test suite', () => {
    const suite: [string, string][] = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ],
      ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ];
    for (const [input, hex] of suite) strictEqual(md5(encoder.encode(input)).toHex(), hex);
  });

  it('pads across the block boundary', () => {
    strictEqual(md5(encoder.encode('x'.repeat(56))).toHex(), '668a72d5ba17f08e62dabcafad6db14b');
  });
});
