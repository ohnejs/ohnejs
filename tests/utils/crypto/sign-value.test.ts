import { match, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { signValue } from '../../../src/utils/crypto/index.ts';

describe('signValue', () => {
  it('appends a base64url tag after a dot', () => {
    match(signValue('hi', 'secret'), /^hi\.[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for the same value and secret', () => {
    strictEqual(signValue('hi', 'secret'), signValue('hi', 'secret'));
  });

  it('changes the tag when the secret changes', () => {
    notStrictEqual(signValue('hi', 'a'), signValue('hi', 'b'));
  });

  it('treats an empty context as no context', () => {
    strictEqual(signValue('hi', 'secret', ''), signValue('hi', 'secret'));
  });

  it('binds the tag to the context', () => {
    notStrictEqual(signValue('hi', 'secret', 'a'), signValue('hi', 'secret', 'b'));
  });
});
