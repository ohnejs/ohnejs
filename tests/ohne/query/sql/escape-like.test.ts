import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { escapeLike } from '../../../../src/ohne/query/sql/escape-like.ts';

describe('escapeLike', () => {
  it('leaves plain text untouched', () => {
    strictEqual(escapeLike('hello'), 'hello');
  });

  it('escapes percent', () => {
    strictEqual(escapeLike('100%'), '100\\%');
  });

  it('escapes underscore', () => {
    strictEqual(escapeLike('a_b'), 'a\\_b');
  });

  it('escapes backslash', () => {
    strictEqual(escapeLike('C:\\dir'), 'C:\\\\dir');
  });

  it('escapes each character once, never re-escaping its own escapes', () => {
    strictEqual(escapeLike('\\%'), '\\\\\\%');
    strictEqual(escapeLike('50%_\\'), '50\\%\\_\\\\');
  });
});
