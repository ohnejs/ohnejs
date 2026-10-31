import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { totpCode, verifyTOTP } from '../../../src/utils/crypto/index.ts';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const time = 1_111_111_109_000;
const step = Math.floor(time / 30_000);

describe('verifyTOTP', () => {
  it('returns the step of the current code', () => {
    strictEqual(verifyTOTP(totpCode(SECRET, { time }), SECRET, { time }), step);
  });

  it('accepts one period of drift either way by default', () => {
    strictEqual(verifyTOTP(totpCode(SECRET, { time: time - 30_000 }), SECRET, { time }), step - 1);
    strictEqual(verifyTOTP(totpCode(SECRET, { time: time + 30_000 }), SECRET, { time }), step + 1);
  });

  it('rejects a code outside the window', () => {
    strictEqual(verifyTOTP(totpCode(SECRET, { time: time - 60_000 }), SECRET, { time }), undefined);
    strictEqual(verifyTOTP(totpCode(SECRET, { time: time + 60_000 }), SECRET, { time }), undefined);
  });

  it('widens and narrows with `window`', () => {
    const late = totpCode(SECRET, { time: time - 60_000 });
    strictEqual(verifyTOTP(late, SECRET, { time, window: 2 }), step - 2);
    strictEqual(
      verifyTOTP(totpCode(SECRET, { time: time - 30_000 }), SECRET, { time, window: 0 }),
      undefined,
    );
  });

  it('verifies under the same parameters the code was made with', () => {
    const options = { time, digits: 8, period: 60, algorithm: 'sha256' } as const;
    strictEqual(verifyTOTP(totpCode(SECRET, options), SECRET, options), Math.floor(time / 60_000));
    strictEqual(verifyTOTP(totpCode(SECRET, options), SECRET, { time }), undefined);
  });

  it('rejects a wrong or malformed code', () => {
    strictEqual(verifyTOTP('000000', SECRET, { time }), undefined);
    strictEqual(verifyTOTP('', SECRET, { time }), undefined);
    strictEqual(verifyTOTP(` ${totpCode(SECRET, { time })}`, SECRET, { time }), undefined);
  });

  it('skips the steps before the epoch', () => {
    strictEqual(verifyTOTP(totpCode(SECRET, { time: -30_000 }), SECRET, { time: 0 }), undefined);
  });
});
