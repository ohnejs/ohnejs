import { match, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { randomToken } from '../../../src/utils/crypto/index.ts';

describe('randomToken', () => {
  it('defaults to 32 bytes (43 base64url chars)', () => {
    strictEqual(randomToken().length, 43);
  });

  it('encodes the requested byte count', () => {
    strictEqual(randomToken(16).length, 22);
  });

  it('uses the URL-safe base64url alphabet with no padding', () => {
    match(randomToken(), /^[A-Za-z0-9_-]+$/);
  });

  it('returns a different token each call', () => {
    notStrictEqual(randomToken(), randomToken());
  });
});
