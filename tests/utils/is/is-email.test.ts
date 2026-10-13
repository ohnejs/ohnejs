import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isEmail } from '../../../src/utils/index.ts';

describe('isEmail', () => {
  it('returns true for simple addresses', () => {
    strictEqual(isEmail('user@ohne.dev'), true);
    strictEqual(isEmail('a@b.co'), true);
  });

  it('returns true for addresses with subdomains and pluses', () => {
    strictEqual(isEmail('first.last+tag@mail.example.com'), true);
  });

  it('returns false for addresses missing @ or domain dot', () => {
    strictEqual(isEmail('not-an-email'), false);
    strictEqual(isEmail('a@b'), false);
  });

  it('returns false for addresses with multiple @', () => {
    strictEqual(isEmail('a@b@c.de'), false);
  });

  it('returns false for addresses with whitespace', () => {
    strictEqual(isEmail('a b@c.de'), false);
    strictEqual(isEmail('a@b .de'), false);
  });

  it('returns false for addresses with leading, trailing, or consecutive dots', () => {
    strictEqual(isEmail('.a@b.de'), false);
    strictEqual(isEmail('a.@b.de'), false);
    strictEqual(isEmail('a..b@c.de'), false);
    strictEqual(isEmail('a@.b.de'), false);
    strictEqual(isEmail('a@b.de.'), false);
    strictEqual(isEmail('a@b..de'), false);
  });

  it('returns false for overlong addresses', () => {
    const local = 'a'.repeat(65);
    strictEqual(isEmail(`${local}@b.de`), false);
    strictEqual(isEmail(`${'a'.repeat(250)}@b.de`), false);
  });

  it('returns true for unicode addresses and every `atext` character', () => {
    strictEqual(isEmail('jürgen@münchen.de'), true);
    strictEqual(isEmail('a?b@x.example'), true);
    strictEqual(isEmail('a#b@x.example'), true);
    strictEqual(isEmail("!#$%&'*+-/=?^_`{|}~@x.example"), true);
  });

  it('returns false for a query, fragment, port or scheme around the address', () => {
    strictEqual(isEmail('a@x.example?subject=hi'), false);
    strictEqual(isEmail('a@x.example#f'), false);
    strictEqual(isEmail('a@x.example:25'), false);
    strictEqual(isEmail('mailto:a@x.example'), false);
  });

  it('returns false for a local part outside the dot-atom grammar', () => {
    strictEqual(isEmail('a,b@x.example'), false);
    strictEqual(isEmail('a<b>@x.example'), false);
    strictEqual(isEmail('"a"@x.example'), false);
    strictEqual(isEmail('a\u00a0b@x.example'), false);
    strictEqual(isEmail('a\u200b@x.example'), false);
    strictEqual(isEmail('a\u034fb@x.example'), false);
  });

  it('returns false for a domain that is no public domain name', () => {
    strictEqual(isEmail('a@-x.example'), false);
    strictEqual(isEmail('a@x_y.example'), false);
    strictEqual(isEmail('a@1.2'), false);
    strictEqual(isEmail('a@0x7f.0x1'), false);
    strictEqual(isEmail('a@[127.0.0.1]'), false);
  });

  it('returns false for non-string inputs', () => {
    strictEqual(isEmail(undefined), false);
    strictEqual(isEmail(null), false);
    strictEqual(isEmail(123), false);
    strictEqual(isEmail({}), false);
    strictEqual(isEmail([]), false);
  });

  it('returns false for addresses with ASCII control characters', () => {
    strictEqual(isEmail('a\x01b@c.de'), false);
    strictEqual(isEmail('a@b\x1fc.de'), false);
    strictEqual(isEmail('a\tb@c.de'), false);
    strictEqual(isEmail('a@b\nc.de'), false);
  });
});
