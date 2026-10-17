import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeShell } from '../../../../src/utils/highlight/languages/sh.ts';

const spans = (code: string) =>
  tokenizeShell(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeShell', () => {
  it('classifies the command, flags, strings, variables and comments', () => {
    deepStrictEqual(spans(`echo -n 'a' "b" $HOME \${X} # c`), [
      ['keyword', 'echo'],
      ['attribute', '-n'],
      ['string', "'a'"],
      ['string', '"b"'],
      ['variable', '$HOME'],
      ['variable', '${X}'],
      ['comment', '# c'],
    ]);
  });

  it('opens the command slot after each separator and line', () => {
    deepStrictEqual(spans('a x && b x | c x; d x\ne x'), [
      ['keyword', 'a'],
      ['keyword', 'b'],
      ['keyword', 'c'],
      ['keyword', 'd'],
      ['keyword', 'e'],
    ]);
  });

  it('keeps the slot open past an assignment', () => {
    deepStrictEqual(spans('NODE_ENV=test node x'), [['keyword', 'node']]);
  });

  it('closes the slot at a string or variable', () => {
    deepStrictEqual(spans('$EDITOR file'), [['variable', '$EDITOR']]);
  });

  it('carries a command across an escaped newline', () => {
    deepStrictEqual(spans('pnpm \\\n  add'), [['keyword', 'pnpm']]);
  });

  it('reads `#` inside a word as part of it', () => {
    deepStrictEqual(spans('git log a#b'), [['keyword', 'git']]);
  });

  it('ends an unterminated string at its line', () => {
    deepStrictEqual(spans("echo 'open\nls"), [
      ['keyword', 'echo'],
      ['string', "'open"],
      ['keyword', 'ls'],
    ]);
  });

  it('starts every call with the command slot open', () => {
    tokenizeShell('a b');
    deepStrictEqual(spans('c'), [['keyword', 'c']]);
  });
});
