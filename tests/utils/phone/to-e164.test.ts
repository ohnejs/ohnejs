import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toE164 } from '../../../src/utils/index.ts';

describe('toE164', () => {
  it('reads a national number with the default calling code', () => {
    strictEqual(toE164('0171 1234567'), '+491711234567');
    strictEqual(toE164('089 / 123 45-67'), '+49891234567');
    strictEqual(toE164('(089) 123.456'), '+4989123456');
  });

  it('drops a `(0)` trunk marker after the country code', () => {
    strictEqual(toE164('+49 (0)89 123456'), '+4989123456');
  });

  it('drops a trunk `0` written after `+49`, `+43` or `+41`', () => {
    strictEqual(toE164('+49 089 123456'), '+4989123456');
    strictEqual(toE164('0049 089 123456'), '+4989123456');
    strictEqual(toE164('+43 01 5052000'), '+4315052000');
    strictEqual(toE164('+39 06 1234567'), '+39061234567');
  });

  it('drops a leading label', () => {
    strictEqual(toE164('Tel.: 089 123456'), '+4989123456');
    strictEqual(toE164('Mobil +49 171 1234567'), '+491711234567');
  });

  it('turns `00` into `+`', () => {
    strictEqual(toE164('004989123456'), '+4989123456');
  });

  it('reads bare digits only as an international number when asked', () => {
    strictEqual(toE164('4989123456'), null);
    strictEqual(toE164('4989123456', { bare: 'international' }), '+4989123456');
  });

  it('takes another calling code', () => {
    strictEqual(toE164('01 23 45 67 89', { callingCode: '33' }), '+33123456789');
  });

  it('returns `null` for text and for a number too short or too long', () => {
    strictEqual(toE164('abc'), null);
    strictEqual(toE164('abc', { bare: 'international' }), null);
    strictEqual(toE164('+49 89 1'), null);
    strictEqual(toE164('+49 1234 5678 9012 34'), null);
  });
});
