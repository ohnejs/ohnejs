import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isCountryCode } from '../../../src/utils/index.ts';

describe('isCountryCode', () => {
  it('accepts an assigned code in upper case, and Kosovo', () => {
    strictEqual(isCountryCode('DE'), true);
    strictEqual(isCountryCode('XK'), true);
  });

  it('refuses lower case, aliases, groupings, alpha-3 and non-strings', () => {
    for (const value of ['de', 'UK', 'EU', 'DEU', '', 49, null, undefined]) {
      strictEqual(isCountryCode(value), false, String(value));
    }
  });
});
