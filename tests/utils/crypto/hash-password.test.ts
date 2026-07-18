import { match, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hashPassword } from '../../../src/utils/crypto/index.ts';

describe('hashPassword', () => {
  it('produces a self-describing scrypt string', async () => {
    match(await hashPassword('hunter2'), /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it('salts each hash, so the same password hashes differently', async () => {
    notStrictEqual(await hashPassword('hunter2'), await hashPassword('hunter2'));
  });

  it('hashes an empty password', async () => {
    match(await hashPassword(''), /^scrypt\$/);
  });

  it('writes the given cost parameters into the string', async () => {
    match(await hashPassword('hunter2', { cost: 1024, blockSize: 4 }), /^scrypt\$1024\$4\$1\$/);
  });
});
