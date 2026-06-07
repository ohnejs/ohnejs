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
