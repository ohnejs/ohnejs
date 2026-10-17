import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { editRange } from '../../../src/utils/text/edit-range.ts';

describe('editRange', () => {
  it('is empty where removed text was', () => {
    deepStrictEqual(editRange('hello big world', 'hello world'), { start: 6, end: 6 });
    deepStrictEqual(editRange('abc', ''), { start: 0, end: 0 });
  });

  it('spans inserted text', () => {
    deepStrictEqual(editRange('hello world', 'hello big world'), { start: 6, end: 10 });
    deepStrictEqual(editRange('', 'abc'), { start: 0, end: 3 });
  });

  it('spans replaced text', () => {
    deepStrictEqual(editRange('let a = 1', 'let b = 1'), { start: 4, end: 5 });
    deepStrictEqual(editRange('The Rise of', 'The Fall of'), { start: 4, end: 8 });
  });

  it('never lets the shared start and end overlap in repeated text', () => {
    deepStrictEqual(editRange('aa', 'aaa'), { start: 2, end: 3 });
    deepStrictEqual(editRange('aaa', 'aa'), { start: 2, end: 2 });
    deepStrictEqual(editRange('  x', '    x'), { start: 2, end: 4 });
  });

  it('keeps the end of equal text', () => {
    deepStrictEqual(editRange('same', 'same'), { start: 4, end: 4 });
    deepStrictEqual(editRange('same', 'same', 2), { start: 2, end: 2 });
  });

  describe('with a caret', () => {
    it('slides to the place the caret sits at when the edit repeats its neighbor', () => {
      deepStrictEqual(editRange('Yes, You', 'You', 5), { start: 0, end: 0 });
      deepStrictEqual(editRange('You', 'Yes, You', 0), { start: 0, end: 5 });
      deepStrictEqual(editRange('the LLich', 'the Lich', 5), { start: 4, end: 4 });
      deepStrictEqual(editRange('the Lich', 'the LLich', 4), { start: 4, end: 5 });
      deepStrictEqual(editRange('the the x', 'the x', 4), { start: 0, end: 0 });
    });

    it('lands at the line end an Enter was typed at', () => {
      deepStrictEqual(editRange('a\n  \nb', 'a\nb', 4), { start: 1, end: 1 });
      deepStrictEqual(editRange('a\nb', 'a\n  \nb', 1), { start: 1, end: 4 });
    });

    it('widens a replacement to the caret further along its word', () => {
      deepStrictEqual(editRange('Lich Thing', 'Lich King', 10), { start: 5, end: 9 });
      deepStrictEqual(editRange('Lich King', 'Lich Thing', 9), { start: 5, end: 10 });
      deepStrictEqual(editRange("q('Guilds')", "q('Raids')", 9), { start: 3, end: 8 });
      deepStrictEqual(editRange("q('Raids')", "q('Guilds')", 8), { start: 3, end: 9 });
    });

    it('ignores a caret no end of the edit explains', () => {
      deepStrictEqual(editRange('hello world', 'hello big world', 11), { start: 6, end: 10 });
      deepStrictEqual(editRange('hello', 'helo', 5), { start: 3, end: 3 });
      deepStrictEqual(editRange('Lich Thing!', 'Lich King!', 11), { start: 5, end: 6 });
      deepStrictEqual(editRange('aa', 'aaa', 9), { start: 2, end: 3 });
    });
  });
});
