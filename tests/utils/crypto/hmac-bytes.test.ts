import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hmac, hmacBytes } from '../../../src/utils/crypto/index.ts';

describe('hmacBytes', () => {
  it('matches RFC 4231 test case 2', () => {
    strictEqual(
      hmacBytes('what do ya want for nothing?', 'Jefe').toHex(),
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('holds the raw bytes of the tag `hmac` encodes', () => {
    strictEqual(
      hmacBytes('hi', 'secret').toBase64({ alphabet: 'base64url', omitPadding: true }),
      hmac('hi', 'secret'),
    );
  });

  it('accepts raw key bytes, so derivations chain', () => {
    const key = hmacBytes('date', 'secret');
    strictEqual(hmacBytes('region', key).byteLength, 32);
    strictEqual(hmacBytes('region', key).toHex(), hmacBytes('region', key).toHex());
  });
});
