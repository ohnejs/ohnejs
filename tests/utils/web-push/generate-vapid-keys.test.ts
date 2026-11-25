import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { generateVAPIDKeys } from '../../../src/utils/index.ts';

describe('generateVAPIDKeys', () => {
  it('returns an uncompressed public point and a 32-byte private scalar', async () => {
    const { publicKey, privateKey } = await generateVAPIDKeys();
    const point = Buffer.from(publicKey, 'base64url');
    strictEqual(point.length, 65);
    strictEqual(point[0], 4);
    strictEqual(Buffer.from(privateKey, 'base64url').length, 32);
    strictEqual(/^[\w-]+$/.test(publicKey + privateKey), true);
  });

  it('returns a fresh pair each call', async () => {
    const [a, b] = await Promise.all([generateVAPIDKeys(), generateVAPIDKeys()]);
    strictEqual(a.privateKey === b.privateKey, false);
  });
});
