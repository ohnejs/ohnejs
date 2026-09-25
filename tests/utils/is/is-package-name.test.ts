import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPackageName } from '../../../src/utils/index.ts';

describe('isPackageName', () => {
  it('accepts lowercase, URL-safe names up to 214 characters', () => {
    for (const name of ['my-app', 'my_app.v2', '0', '@acme/ui', 'a'.repeat(214)]) {
      strictEqual(isPackageName(name), true, name);
    }
  });

  it('rejects spaces, capitals, symbols, and control characters', () => {
    for (const name of ['my app', 'My-App', "it's", 'café', '~x', 'my\napp']) {
      strictEqual(isPackageName(name), false, name);
    }
  });

  it('rejects a leading `.`, `_`, or `-`', () => {
    for (const name of ['.hidden', '_x', '-dash']) strictEqual(isPackageName(name), false, name);
  });

  it('rejects a malformed scope', () => {
    for (const name of ['@acme', '@/x', '@a/b/c']) strictEqual(isPackageName(name), false, name);
  });

  it('rejects an empty name, one over 214 characters, and a non-string', () => {
    strictEqual(isPackageName(''), false);
    strictEqual(isPackageName('a'.repeat(215)), false);
    strictEqual(isPackageName(42), false);
  });
});
