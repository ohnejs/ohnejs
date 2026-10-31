import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { totpSecret } from '../../../src/utils/crypto/index.ts';
import { decodeBase32 } from '../../../src/utils/index.ts';

describe('totpSecret', () => {
  it('is 20 random bytes in base32 by default', () => {
    const secret = totpSecret();
    strictEqual(secret.length, 32);
    strictEqual(/^[A-Z2-7]+$/.test(secret), true);
    strictEqual(decodeBase32(secret).byteLength, 20);
  });

  it('takes a byte count', () => {
    strictEqual(decodeBase32(totpSecret(32)).byteLength, 32);
  });

  it('differs per call', () => {
    strictEqual(totpSecret() === totpSecret(), false);
  });
});
