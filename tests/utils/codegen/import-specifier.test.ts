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

  it('percent-encodes only the URL-breaking characters', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/50%off.ts'), '../api/50%25off.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/c#.ts'), '../api/c%23.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/what?.ts'), '../api/what%3F.ts');
  });

  it('leaves a dynamic-route bracket raw so TypeScript can resolve it', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/[id].get.ts'), '../api/[id].get.ts');
  });

  it('leaves spaces and non-ASCII raw, which Node resolves as-is', () => {
    strictEqual(importSpecifier('/app/.gen', '/app/api/a b.ts'), '../api/a b.ts');
    strictEqual(importSpecifier('/app/.gen', '/app/api/über.ts'), '../api/über.ts');
  });
});
