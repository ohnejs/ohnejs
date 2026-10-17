import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { lineIndent } from '../../../src/utils/text/line-indent.ts';

describe('lineIndent', () => {
  it('reads the leading whitespace of the line holding the offset', () => {
    strictEqual(lineIndent('a\n \tb\nc', 5), ' \t');
  });

  it('reads the first line from offset zero', () => {
    strictEqual(lineIndent('  a', 0), '');
    strictEqual(lineIndent('  a', 3), '  ');
  });

  it('cuts the indent at the offset', () => {
    strictEqual(lineIndent('    a', 2), '  ');
  });

  it('gives nothing for an unindented or empty line', () => {
    strictEqual(lineIndent('a\nb', 3), '');
    strictEqual(lineIndent('a\n\nb', 2), '');
  });

  it('reads the line a trailing newline opens', () => {
    strictEqual(lineIndent('  a\n', 4), '');
  });
});
