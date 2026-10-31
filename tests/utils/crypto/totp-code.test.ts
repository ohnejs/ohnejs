import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type TOTPAlgorithm, totpCode } from '../../../src/utils/crypto/index.ts';
import { encodeBase32 } from '../../../src/utils/index.ts';

const SECRETS: Record<TOTPAlgorithm, string> = {
  sha1: encodeBase32(new TextEncoder().encode('12345678901234567890')),
  sha256: encodeBase32(new TextEncoder().encode('12345678901234567890123456789012')),
  sha512: encodeBase32(
    new TextEncoder().encode('1234567890123456789012345678901234567890123456789012345678901234'),
  ),
};

const VECTORS: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('totpCode', () => {
  it('matches the RFC 6238 Appendix B vectors', () => {
    for (const [seconds, sha1, sha256, sha512] of VECTORS) {
      const time = seconds * 1000;
      strictEqual(totpCode(SECRETS.sha1, { time, digits: 8 }), sha1);
      strictEqual(totpCode(SECRETS.sha256, { time, digits: 8, algorithm: 'sha256' }), sha256);
      strictEqual(totpCode(SECRETS.sha512, { time, digits: 8, algorithm: 'sha512' }), sha512);
    }
  });

  it('defaults to 6 digits', () => {
    strictEqual(totpCode(SECRETS.sha1, { time: 59_000 }), '287082');
    strictEqual(totpCode(SECRETS.sha1, { time: 1_111_111_109_000 }), '081804');
  });

  it('holds a code for one period', () => {
    strictEqual(totpCode(SECRETS.sha1, { time: 30_000 }), totpCode(SECRETS.sha1, { time: 59_999 }));
    strictEqual(
      totpCode(SECRETS.sha1, { time: 0, period: 60 }),
      totpCode(SECRETS.sha1, { time: 59_999, period: 60 }),
    );
  });

  it('reads a secret in any case and spacing', () => {
    strictEqual(
      totpCode(SECRETS.sha1.toLowerCase().replace(/(.{4})/g, '$1 '), { time: 59_000 }),
      '287082',
    );
  });
});
