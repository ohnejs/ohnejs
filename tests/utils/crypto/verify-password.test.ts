import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hashPassword, verifyPassword } from '../../../src/utils/crypto/index.ts';

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    strictEqual(await verifyPassword('hunter2', await hashPassword('hunter2')), true);
  });

  it('rejects a wrong password', async () => {
    strictEqual(await verifyPassword('wrong', await hashPassword('hunter2')), false);
  });

  it('is case- and whitespace-sensitive', async () => {
    const stored = await hashPassword('hunter2');
    strictEqual(await verifyPassword('Hunter2', stored), false);
    strictEqual(await verifyPassword('hunter2 ', stored), false);
  });

  it('verifies a hash written under different cost parameters', async () => {
    // A hand-built scrypt string with N=1024, proving the stored params drive the derivation.
    const salt = Buffer.from('c2FsdHNhbHRzYWx0c2E', 'base64url');
    strictEqual(salt.length, 14);
    const { scryptDerive } = await import('../../../src/utils/crypto/_scrypt.ts');
    const key = await scryptDerive('hunter2', salt, 64, {
      cost: 1024,
      blockSize: 8,
      parallelization: 1,
    });
    const stored = `scrypt$1024$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
    strictEqual(await verifyPassword('hunter2', stored), true);
    strictEqual(await verifyPassword('wrong', stored), false);
  });

  it('returns false for a malformed stored hash rather than throwing', async () => {
    strictEqual(await verifyPassword('hunter2', 'not-a-hash'), false);
    strictEqual(await verifyPassword('hunter2', 'scrypt$32768$8$1$onlyfourfields'), false);
    strictEqual(await verifyPassword('hunter2', 'scrypt$32768$8$1$c2FsdA$'), false);
    strictEqual(await verifyPassword('hunter2', ''), false);
  });
});
