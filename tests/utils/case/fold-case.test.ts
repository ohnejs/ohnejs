import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { foldCase } from '../../../src/utils/case/fold-case.ts';

describe('foldCase', () => {
  it('lowercases every script', () => {
    strictEqual(foldCase('Émile ПРИВЕТ'), 'émile привет');
  });

  it('reads a final sigma as a medial one', () => {
    strictEqual(foldCase('ΣΟΦΙΑΣ'), 'σοφιασ');
    strictEqual(foldCase('σοφιας'), 'σοφιασ');
  });

  it('folds only ASCII letters with `asciiOnly`', () => {
    strictEqual(foldCase('KELVIN K İ', true), 'kelvin K İ');
  });
});
