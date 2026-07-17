import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsdocBlock } from '../../../src/utils/codegen/index.ts';

describe('jsdocBlock', () => {
  it('wraps a single line', () => {
    strictEqual(jsdocBlock('A page title.'), '/**\n * A page title.\n */');
  });

  it('prefixes every line and keeps blank lines as a bare star', () => {
    strictEqual(jsdocBlock('First.\n\nSecond.'), '/**\n * First.\n *\n * Second.\n */');
  });

  it('escapes an inner close sequence so it cannot end the block early', () => {
    strictEqual(jsdocBlock('ends with */ inside'), '/**\n * ends with *\\/ inside\n */');
  });

  it('carries no outer indentation', () => {
    strictEqual(jsdocBlock('x').startsWith('/**'), true);
  });
});
