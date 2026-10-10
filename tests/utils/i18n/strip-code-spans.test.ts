import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { codeSpan } from '../../../src/utils/ansi/code-span.ts';
import { stripCodeSpans } from '../../../src/utils/i18n/strip-code-spans.ts';

describe('stripCodeSpans', () => {
  it('shows each span as its text and keeps the rest as written', () => {
    strictEqual(stripCodeSpans('Nothing found for `cats`'), 'Nothing found for cats');
    strictEqual(stripCodeSpans('`__init__` in __Drafts__ **x**'), '__init__ in __Drafts__ **x**');
    strictEqual(stripCodeSpans('a ` unclosed'), 'a ` unclosed');
  });

  it('reads back any value `codeSpan` fences', () => {
    for (const value of ['a`b', '`x', 'x`', ' pad ', '``', 'a b']) {
      strictEqual(stripCodeSpans(`for ${codeSpan(value)} now`), `for ${value} now`);
    }
  });
});
