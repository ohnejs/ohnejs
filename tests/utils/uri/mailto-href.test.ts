import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mailtoHref } from '../../../src/utils/index.ts';

describe('mailtoHref', () => {
  it('encodes the local part, so the href names one recipient and nothing else', () => {
    for (const email of ['a?b@x.example', 'a#b@x.example', 'a%b@x.example', 'jürgen@x.example']) {
      const url = URL.parse(mailtoHref(email)!)!;
      strictEqual(decodeURIComponent(url.pathname), email);
      strictEqual(url.search, '');
      strictEqual(url.hash, '');
    }
  });

  it('keeps a plain address as written', () => {
    strictEqual(mailtoHref('thrall@orgrimmar.example'), 'mailto:thrall@orgrimmar.example');
  });

  it('returns undefined for a value that is no email address', () => {
    strictEqual(mailtoHref('nope'), undefined);
    strictEqual(mailtoHref('a@x.example?cc=b@y.example'), undefined);
  });
});
