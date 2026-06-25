import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { signValue, unsignValue } from '../../../src/utils/crypto/index.ts';

describe('unsignValue', () => {
  it('recovers the signed value', () => {
    strictEqual(unsignValue(signValue('user-42', 'secret'), 'secret'), 'user-42');
  });

  it('preserves a value containing dots', () => {
    strictEqual(unsignValue(signValue('a.b.c', 'secret'), 'secret'), 'a.b.c');
  });

  it('rejects a wrong secret', () => {
    strictEqual(unsignValue(signValue('hi', 'secret'), 'other'), null);
  });

  it('rejects a tampered tag', () => {
    strictEqual(unsignValue('hi.forged', 'secret'), null);
  });

  it('returns null when there is no tag', () => {
    strictEqual(unsignValue('notsigned', 'secret'), null);
  });

  it('round-trips an empty value as the empty string', () => {
    strictEqual(unsignValue(signValue('', 'secret'), 'secret'), '');
  });

  it('recovers a value signed under a matching context', () => {
    strictEqual(unsignValue(signValue('hi', 'secret', 'sid'), 'secret', 'sid'), 'hi');
  });

  it('rejects a value verified under a different context', () => {
    strictEqual(unsignValue(signValue('hi', 'secret', 'sid'), 'secret', 'other'), null);
  });
});
