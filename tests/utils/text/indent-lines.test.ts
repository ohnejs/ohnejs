import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { indentLines } from '../../../src/utils/text/indent-lines.ts';

describe('indentLines', () => {
  it('indents the caret line and moves the caret along', () => {
    deepStrictEqual(indentLines('a\nb', 3, 3, '  '), {
      from: 2,
      to: 3,
      insert: '  b',
      start: 5,
      end: 5,
    });
  });

  it('moves a caret at column zero past the new indent', () => {
    deepStrictEqual(indentLines('a', 0, 0, '\t'), {
      from: 0,
      to: 1,
      insert: '\ta',
      start: 1,
      end: 1,
    });
  });

  it('indents every touched line and widens a selection from a line start', () => {
    deepStrictEqual(indentLines('a\nb\nc', 0, 3, '  '), {
      from: 0,
      to: 3,
      insert: '  a\n  b',
      start: 0,
      end: 7,
    });
  });

  it('shifts a selection start inside its line', () => {
    deepStrictEqual(indentLines('ab\ncd', 1, 4, '  '), {
      from: 0,
      to: 5,
      insert: '  ab\n  cd',
      start: 3,
      end: 8,
    });
  });

  it('skips empty lines', () => {
    deepStrictEqual(indentLines('a\n\nb', 0, 4, '  '), {
      from: 0,
      to: 4,
      insert: '  a\n\n  b',
      start: 0,
      end: 8,
    });
  });

  it('leaves the line a selection ends at the start of', () => {
    deepStrictEqual(indentLines('a\nb\nc', 0, 4, '  '), {
      from: 0,
      to: 3,
      insert: '  a\n  b',
      start: 0,
      end: 8,
    });
  });

  it('touches only the lines of the selection', () => {
    const text = 'a\nb\nc';
    const edit = indentLines(text, 2, 3, '  ');
    deepStrictEqual(text.slice(0, edit.from) + edit.insert + text.slice(edit.to), 'a\n  b\nc');
  });
});
