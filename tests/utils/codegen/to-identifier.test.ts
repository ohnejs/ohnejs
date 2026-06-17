import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toIdentifier } from '../../../src/utils/codegen/index.ts';

describe('toIdentifier', () => {
  it('keeps a valid identifier as is', () => {
    strictEqual(toIdentifier('fooBar'), 'fooBar');
    strictEqual(toIdentifier('_private$'), '_private$');
  });

  it('collapses runs of invalid characters into one underscore', () => {
    strictEqual(toIdentifier('foo-bar'), 'foo_bar');
    strictEqual(toIdentifier('user.profile'), 'user_profile');
    strictEqual(toIdentifier('a---b'), 'a_b');
  });

  it('prefixes a leading digit', () => {
    strictEqual(toIdentifier('2cool'), '_2cool');
  });

  it('prefixes reserved words', () => {
    strictEqual(toIdentifier('class'), '_class');
    strictEqual(toIdentifier('await'), '_await');
  });

  it('prefixes an empty result', () => {
    strictEqual(toIdentifier(''), '_');
    strictEqual(toIdentifier('!!!'), '_');
  });
});
