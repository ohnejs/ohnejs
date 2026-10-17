import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { lineCount } from '../../../src/utils/text/line-count.ts';

describe('lineCount', () => {
  it('counts the empty text as one line', () => {
    strictEqual(lineCount(''), 1);
  });

  it('counts one more line than newlines', () => {
    strictEqual(lineCount('a'), 1);
    strictEqual(lineCount('a\nb'), 2);
    strictEqual(lineCount('a\n\n'), 3);
  });

  it('counts a carriage return as no line break', () => {
    strictEqual(lineCount('a\r\nb\rc'), 2);
  });
});
