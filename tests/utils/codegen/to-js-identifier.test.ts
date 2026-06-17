import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toJSIdentifier } from '../../../src/utils/codegen/index.ts';

describe('toJSIdentifier', () => {
  it('keeps a valid identifier as is', () => {
    strictEqual(toJSIdentifier('fooBar'), 'fooBar');
    strictEqual(toJSIdentifier('_private$'), '_private$');
  });

  it('collapses runs of invalid characters into one underscore', () => {
    strictEqual(toJSIdentifier('foo-bar'), 'foo_bar');
    strictEqual(toJSIdentifier('user.profile'), 'user_profile');
    strictEqual(toJSIdentifier('a---b'), 'a_b');
  });

  it('prefixes a leading digit', () => {
    strictEqual(toJSIdentifier('2cool'), '_2cool');
  });

  it('prefixes reserved words', () => {
    strictEqual(toJSIdentifier('class'), '_class');
    strictEqual(toJSIdentifier('await'), '_await');
  });

  it('prefixes an empty result', () => {
    strictEqual(toJSIdentifier(''), '_');
    strictEqual(toJSIdentifier('!!!'), '_');
  });
});
