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
});
