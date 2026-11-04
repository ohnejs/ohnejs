import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { firstLine } from '../../../src/utils/text/first-line.ts';

describe('firstLine', () => {
  it('keeps text without a line break whole', () => {
    strictEqual(firstLine('tar: Cannot open'), 'tar: Cannot open');
  });

  it('cuts at the first line break', () => {
    strictEqual(firstLine('Command failed\n  at run\n'), 'Command failed');
    strictEqual(firstLine('a\r\nb'), 'a');
  });

  it('skips leading blank lines and trims the line', () => {
    strictEqual(firstLine('\n \n  ENOENT: open  \nb'), 'ENOENT: open');
  });

  it('gives the empty string for blank text', () => {
    strictEqual(firstLine(''), '');
    strictEqual(firstLine(' \n\t'), '');
  });
});
