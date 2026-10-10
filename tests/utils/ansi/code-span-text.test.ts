import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { codeSpanText } from '../../../src/utils/ansi/index.ts';

describe('codeSpanText', () => {
  it('drops the fences of any length', () => {
    strictEqual(codeSpanText('`a`'), 'a');
    strictEqual(codeSpanText('``a`b``'), 'a`b');
  });

  it('keeps content without padding on both sides', () => {
    strictEqual(codeSpanText('` a`'), ' a');
  });

  it('drops one space per side from padded content', () => {
    strictEqual(codeSpanText('`` `x ``'), '`x');
    strictEqual(codeSpanText('`  a  `'), ' a ');
  });

  it('keeps content of spaces only', () => {
    strictEqual(codeSpanText('` `'), ' ');
    strictEqual(codeSpanText('`  `'), '  ');
  });
});
