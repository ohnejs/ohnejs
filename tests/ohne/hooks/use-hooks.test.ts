import { deepStrictEqual, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { useHooks } from '../../../src/ohne/index.ts';

describe('useHooks', () => {
  beforeEach(() => {
    useHooks().clear();
  });

  it('returns the same registry every call', () => {
    strictEqual(useHooks(), useHooks());
  });

  it('appends callbacks on collision instead of replacing', () => {
    const a = () => 1;
    const b = () => 2;
    useHooks().register('x', [a]);
    useHooks().register('x', [b]);
    deepStrictEqual(useHooks().get('x'), [a, b]);
  });
});
