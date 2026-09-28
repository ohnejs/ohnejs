import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { terminalWidth } from '../../../src/utils/ansi/index.ts';

describe('terminalWidth', () => {
  it('counts one column per narrow character', () => {
    strictEqual(terminalWidth(''), 0);
    strictEqual(terminalWidth('abc'), 3);
    strictEqual(terminalWidth('◆  │ ● ○ ◼ ⠋'), 12);
  });

  it('counts two columns per wide character', () => {
    strictEqual(terminalWidth('漢字'), 4);
    strictEqual(terminalWidth('ひらがなカタカナ'), 16);
    strictEqual(terminalWidth('한국어'), 6);
    strictEqual(terminalWidth('ＡＢ'), 4);
    strictEqual(terminalWidth('😀a'), 3);
  });

  it('counts combining marks, zero-width joiners, and controls as no columns', () => {
    strictEqual(terminalWidth('e\u0301'), 1);
    strictEqual(terminalWidth('a\u200db'), 2);
    strictEqual(terminalWidth('a\u0007b'), 2);
  });

  it('ignores ANSI escape codes', () => {
    strictEqual(terminalWidth('\x1b[1m\x1b[36mab\x1b[39m\x1b[22m'), 2);
    strictEqual(terminalWidth('\x1b[2m漢\x1b[22m'), 2);
  });
});
