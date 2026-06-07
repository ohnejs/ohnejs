import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isFunction } from '../../../src/utils/index.ts';

describe('isFunction', () => {
  it('returns true for functions', () => {
    strictEqual(
      isFunction(() => 1),
      true,
    );
    strictEqual(
      isFunction(function f() {}),
      true,
    );
    strictEqual(
      isFunction(async () => 1),
      true,
    );
    strictEqual(isFunction(class {}), true);
  });

  it('returns false for non-functions', () => {
    strictEqual(isFunction({}), false);
    strictEqual(isFunction(null), false);
    strictEqual(isFunction(1), false);
  });
});
