import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { applyANSIMarkup, codeSpan, pickANSIColors } from '../../../src/utils/ansi/index.ts';

const plain = pickANSIColors(false);

describe('codeSpan', () => {
  it('fences a plain value with one backtick', () => {
    strictEqual(codeSpan('a.txt'), '`a.txt`');
  });

  it('prints any value exactly through the markup, beside other markup', () => {
    for (const value of [
      'a`b`c.txt',
      'it`s.pdf',
      '`lead',
      'trail`',
      'a``b',
      ' x ',
      'C:\\Users\\thrall\\a`b.txt',
      '__init__.py',
      '**x**',
      '`',
      '',
      ' ',
      'a b.txt',
      'Hi }\r',
    ]) {
      strictEqual(
        applyANSIMarkup(`- ${codeSpan(value)} __in 3ms__`, false, plain),
        `- ${value} in 3ms`,
      );
    }
  });
});
