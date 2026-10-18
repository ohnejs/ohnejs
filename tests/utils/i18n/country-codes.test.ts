import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { countryCodes } from '../../../src/utils/index.ts';

describe('countryCodes', () => {
  it('is sorted and holds every code once', () => {
    deepStrictEqual([...countryCodes].sort(), [...countryCodes]);
    strictEqual(new Set(countryCodes).size, countryCodes.length);
  });

  it('holds only two upper-case letters that stand for themselves', () => {
    for (const code of countryCodes) {
      ok(/^[A-Z]{2}$/.test(code), code);
      strictEqual(new Intl.Locale(`und-${code}`).region, code);
    }
  });

  it('keeps Kosovo, and leaves out aliases, groupings and pseudo-regions', () => {
    ok(countryCodes.includes('XK'));
    for (const code of ['UK', 'AN', 'EU', 'UN', 'ZZ', 'XA', 'AC', 'EA']) {
      ok(!(countryCodes as readonly string[]).includes(code), code);
    }
  });
});
