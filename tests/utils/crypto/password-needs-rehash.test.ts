import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hashPassword, passwordNeedsRehash } from '../../../src/utils/crypto/index.ts';

describe('passwordNeedsRehash', () => {
  it('is false for a hash made with the same parameters', async () => {
    const stored = await hashPassword('pw', { cost: 1024 });
    strictEqual(passwordNeedsRehash(stored, { cost: 1024 }), false);
  });

  it('is true when any parameter differs', async () => {
    const stored = await hashPassword('pw', { cost: 1024 });
    strictEqual(passwordNeedsRehash(stored, { cost: 2048 }), true);
    strictEqual(passwordNeedsRehash(stored, { cost: 1024, blockSize: 4 }), true);
    strictEqual(passwordNeedsRehash(stored, { cost: 1024, parallelization: 2 }), true);
  });

  it('is true for a malformed stored string', () => {
    strictEqual(passwordNeedsRehash('nonsense', { cost: 1024 }), true);
  });

  it('shares its parameter defaults with hashPassword', async () => {
    const stored = await hashPassword('pw');
    strictEqual(passwordNeedsRehash(stored), false);
  });
});
