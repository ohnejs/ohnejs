import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { importSpecifier } from '../../../src/utils/codegen/index.ts';

describe('importSpecifier', () => {
  it('keeps an already-relative specifier', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/users.ts'), '../api/users.ts');
  });

  it('prefixes ./ when the target sits below the from-dir', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/.gen/code.ts'), './code.ts');
  });

  it('percent-encodes URL-special characters in a segment', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/50%off.ts'), '../api/50%25off.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/a b.ts'), '../api/a%20b.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/c#.ts'), '../api/c%23.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/what?.ts'), '../api/what%3F.ts');
  });

  it('encodes a non-ASCII segment', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/über.ts'), '../api/%C3%BCber.ts');
  });
});
