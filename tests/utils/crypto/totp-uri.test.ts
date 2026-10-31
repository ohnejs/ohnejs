import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { totpURI } from '../../../src/utils/crypto/index.ts';

describe('totpURI', () => {
  it('builds an otpauth URI with issuer and account', () => {
    strictEqual(
      totpURI({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'Acme Co', account: 'ada@example.com' }),
      'otpauth://totp/Acme%20Co:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme%20Co',
    );
  });

  it('percent-encodes a colon, so the label keeps one separator', () => {
    strictEqual(
      totpURI({ secret: 'A', issuer: 'A:B', account: "c'd" }),
      'otpauth://totp/A%3AB:c%27d?secret=A&issuer=A%3AB',
    );
  });

  it('adds only the parameters that differ from the defaults', () => {
    strictEqual(
      totpURI({
        secret: 'A',
        issuer: 'I',
        account: 'a',
        algorithm: 'sha256',
        digits: 8,
        period: 60,
      }),
      'otpauth://totp/I:a?secret=A&issuer=I&algorithm=SHA256&digits=8&period=60',
    );
  });
});
