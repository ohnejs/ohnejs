import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { indent } from '../../../src/utils/codegen/index.ts';

describe('indent', () => {
  it('indents a single line by one level', () => {
    strictEqual(indent('a'), '  a');
  });

  it('indents every line', () => {
    strictEqual(indent('a\nb'), '  a\n  b');
  });

  it('respects level and size', () => {
    strictEqual(indent('a\nb', { level: 2 }), '    a\n    b');
    strictEqual(indent('a', { size: 4 }), '    a');
  });

  it('leaves blank lines untouched', () => {
    strictEqual(indent('a\n\nb'), '  a\n\n  b');
  });

  it('returns code unchanged for a non-positive level', () => {
    strictEqual(indent('a\nb', { level: 0 }), 'a\nb');
    strictEqual(indent('a', { level: -1 }), 'a');
  });
});
