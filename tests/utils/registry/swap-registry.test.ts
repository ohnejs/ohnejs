import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createRegistry, swapRegistry } from '../../../src/utils/index.ts';

describe('swapRegistry', () => {
  it('replaces every entry, then restores the previous ones in order', () => {
    const r = createRegistry<number>();
    r.register('b', 2);
    r.register('a', 1);

    const restore = swapRegistry(r, [['c', 3]]);
    deepStrictEqual(Object.entries(r.all()), [['c', 3]]);

    restore();
    deepStrictEqual(r.keys(), ['b', 'a']);
    deepStrictEqual(Object.entries(r.all()), [
      ['b', 2],
      ['a', 1],
    ]);
  });

  it('drops an entry registered after the swap on restore', () => {
    const r = createRegistry<number>();
    r.register('a', 1);

    const restore = swapRegistry(r, []);
    r.register('late', 9);
    restore();
    deepStrictEqual(Object.entries(r.all()), [['a', 1]]);
  });

  it('restores past a merger without folding the values', () => {
    const r = createRegistry<number>({ merge: (existing, incoming) => existing + incoming });
    r.register('a', 1);

    const restore = swapRegistry(r, [['a', 5]]);
    deepStrictEqual(Object.entries(r.all()), [['a', 5]]);
    restore();
    deepStrictEqual(Object.entries(r.all()), [['a', 1]]);
  });
});
