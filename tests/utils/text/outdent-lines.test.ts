import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { outdentLines } from '../../../src/utils/text/outdent-lines.ts';

describe('outdentLines', () => {
  it('removes one unit and moves the caret back', () => {
    deepStrictEqual(outdentLines('    a', 5, 5, '  '), {
      from: 0,
      to: 5,
      insert: '  a',
      start: 3,
      end: 3,
    });
  });

  it('removes one tab when the unit is spaces', () => {
    deepStrictEqual(outdentLines('\t\ta', 3, 3, '  '), {
      from: 0,
      to: 3,
      insert: '\ta',
      start: 2,
      end: 2,
    });
  });

  it('removes up to the unit width of spaces when the unit is missing', () => {
    deepStrictEqual(outdentLines(' a', 2, 2, '    '), {
      from: 0,
      to: 2,
      insert: 'a',
      start: 1,
      end: 1,
    });
  });

  it('outdents every touched line', () => {
    deepStrictEqual(outdentLines('  a\n\tb\nc', 1, 6, '  '), {
      from: 0,
      to: 6,
      insert: 'a\nb',
      start: 0,
      end: 3,
    });
  });

  it('leaves unindented lines and a selection ending at a line start alone', () => {
    deepStrictEqual(outdentLines('a\n  b\n  c', 0, 6, '  '), {
      from: 0,
      to: 5,
      insert: 'a\nb',
      start: 0,
      end: 4,
    });
  });

  it('clamps a caret inside the removed indent to the line start', () => {
    deepStrictEqual(outdentLines('x\n  a', 3, 3, '  '), {
      from: 2,
      to: 5,
      insert: 'a',
      start: 2,
      end: 2,
    });
  });
});
