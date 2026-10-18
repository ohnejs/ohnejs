import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { currencyDigits } from '../../../src/utils/index.ts';

describe('currencyDigits', () => {
  it('holds the ISO 4217 digits, not the engine Intl ones', () => {
    strictEqual(currencyDigits.EUR, 2);
    strictEqual(currencyDigits.JPY, 0);
    strictEqual(currencyDigits.KWD, 3);
    strictEqual(currencyDigits.HUF, 2);
    strictEqual(currencyDigits.IQD, 3);
  });

  it('lists only circulating codes with a minor unit', () => {
    for (const code of ['CLF', 'XAD', 'XAU', 'XXX', 'ANG', 'BGN', 'HRK']) {
      ok(!Object.hasOwn(currencyDigits, code), code);
    }
    for (const code of ['XCG', 'ZWG', 'SLE', 'VED']) ok(Object.hasOwn(currencyDigits, code), code);
  });

  it('keys three upper-case letters to 0, 2 or 3 digits', () => {
    for (const [code, digits] of Object.entries(currencyDigits)) {
      ok(/^[A-Z]{3}$/.test(code), code);
      ok([0, 2, 3].includes(digits), code);
    }
  });
});
