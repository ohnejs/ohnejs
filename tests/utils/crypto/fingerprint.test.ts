import { match, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { fingerprint } from '../../../src/utils/crypto/index.ts';

describe('fingerprint', () => {
  it('takes the first 48 bits of the sha256 as base64url', () => {
    strictEqual(fingerprint(''), '47DEQpj8');
    strictEqual(fingerprint('export const a = 1;\n'), 'A37NHbOM');
  });

  it('stays URL-safe for any input', () => {
    for (const data of ['a', 'é', '?h=&#/', 'x'.repeat(10_000)]) {
      match(fingerprint(data), /^[\w-]{8}$/);
    }
  });

  it('fingerprints bytes the same as their UTF-8 string', () => {
    strictEqual(fingerprint(new TextEncoder().encode('Jaina')), fingerprint('Jaina'));
  });

  it('changes with a one-character edit', () => {
    strictEqual(fingerprint('let a = 1') === fingerprint('let a = 2'), false);
  });
});
