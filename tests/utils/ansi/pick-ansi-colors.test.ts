import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pickANSIColors } from '../../../src/utils/ansi/index.ts';

describe('pickANSIColors', () => {
  it('wraps text in SGR pairs when enabled', () => {
    const color = pickANSIColors(true);
    strictEqual(color.green('x'), '\x1b[32mx\x1b[39m');
    strictEqual(color.cyan('x'), '\x1b[96mx\x1b[39m');
    strictEqual(color.yellow('x'), '\x1b[33mx\x1b[39m');
    strictEqual(color.red('x'), '\x1b[31mx\x1b[39m');
    strictEqual(color.gray('x'), '\x1b[90mx\x1b[39m');
    strictEqual(color.bold('x'), '\x1b[1mx\x1b[22m');
    strictEqual(color.dim('x'), '\x1b[2mx\x1b[22m');
    strictEqual(color.inverse('x'), '\x1b[7mx\x1b[27m');
  });

  it('returns text unchanged when disabled', () => {
    const color = pickANSIColors(false);
    strictEqual(color.cyan('x'), 'x');
    strictEqual(color.dim('x'), 'x');
  });
});
