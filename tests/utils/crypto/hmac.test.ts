import { match, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hmac } from '../../../src/utils/crypto/index.ts';

describe('hmac', () => {
  it('matches RFC 4231 test case 2', () => {
    strictEqual(
      hmac('what do ya want for nothing?', 'Jefe'),
      'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM',
    );
  });

  it('encodes as unpadded base64url', () => {
    match(hmac('hi', 'secret'), /^[A-Za-z0-9_-]{43}$/);
  });

  it('is deterministic for the same value and secret', () => {
    strictEqual(hmac('hi', 'secret'), hmac('hi', 'secret'));
  });

  it('changes with the secret', () => {
    notStrictEqual(hmac('hi', 'a'), hmac('hi', 'b'));
  });

  it('changes with the value', () => {
    notStrictEqual(hmac('a', 'secret'), hmac('b', 'secret'));
  });

  it('accepts raw key bytes', () => {
    strictEqual(hmac('hi', new TextEncoder().encode('Jefe')), hmac('hi', 'Jefe'));
  });
});
