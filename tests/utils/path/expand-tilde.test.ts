import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { expandTilde } from '../../../src/utils/index.ts';

describe('expandTilde', () => {
  it('replaces a leading `~` segment with home', () => {
    strictEqual(expandTilde('~/apps/x', '/home/me'), '/home/me/apps/x');
    strictEqual(expandTilde('~', '/home/me'), '/home/me');
    strictEqual(expandTilde('~\\x', 'C:\\Users\\me'), 'C:\\Users\\me\\x');
  });

  it('leaves a `~` that is not the whole first segment', () => {
    strictEqual(expandTilde('~bob/x', '/home/me'), '~bob/x');
    strictEqual(expandTilde('./~/x', '/home/me'), './~/x');
    strictEqual(expandTilde('a/~', '/home/me'), 'a/~');
  });

  it('inserts home verbatim, even when it holds `$`', () => {
    strictEqual(expandTilde('~/x', '/a$&b'), '/a$&b/x');
  });
});
