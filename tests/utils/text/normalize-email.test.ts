import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { normalizeEmail } from '../../../src/utils/index.ts';

describe('normalizeEmail', () => {
  it('trims and lowercases the address', () => {
    strictEqual(normalizeEmail(' Thrall@Orgrimmar.Example '), 'thrall@orgrimmar.example');
    strictEqual(normalizeEmail('Jürgen@MÜNCHEN.de'), 'jürgen@münchen.de');
  });

  it('composes to NFC', () => {
    strictEqual(normalizeEmail('Jürgen@x.example'), 'jürgen@x.example');
  });

  it('lowercases a final sigma the way IDNA does, so both spellings of a domain match', () => {
    strictEqual(normalizeEmail('Z@EXAMPLE.ΟΔΟΣ'), 'z@example.οδοσ');
    strictEqual(normalizeEmail('z@example.οδοσ'), 'z@example.οδοσ');
    strictEqual(normalizeEmail('z@example.οδος'), 'z@example.οδος');
  });

  it('keeps a punycode domain and compatibility forms as written', () => {
    strictEqual(normalizeEmail('a@XN--MNCHEN-3YA.de'), 'a@xn--mnchen-3ya.de');
    strictEqual(normalizeEmail('Tanaka@ＥＸＡＭＰＬＥ.jp'), 'tanaka@ｅｘａｍｐｌｅ.jp');
  });
});
