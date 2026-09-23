import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { digest } from '../../../src/utils/crypto/index.ts';

describe('digest', () => {
  it('hashes the empty string with sha256', () => {
    strictEqual(
      digest('sha256', '').toHex(),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes with md5 and sha1', () => {
    strictEqual(digest('md5', 'abc').toHex(), '900150983cd24fb0d6963f7d28e17f72');
    strictEqual(digest('sha1', 'abc').toHex(), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('hashes bytes the same as their UTF-8 string', () => {
    deepStrictEqual(digest('sha256', new TextEncoder().encode('é')), digest('sha256', 'é'));
  });

  it('returns a plain Uint8Array of the digest length', () => {
    const bytes = digest('sha256', 'x');
    strictEqual(Object.getPrototypeOf(bytes), Uint8Array.prototype);
    strictEqual(bytes.byteLength, 32);
  });
});
