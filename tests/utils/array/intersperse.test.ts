import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { intersperse } from '../../../src/utils/index.ts';

describe('intersperse', () => {
  it('puts a separator between each pair', () => {
    deepStrictEqual(
      intersperse([1, 2, 3], () => 0),
      [1, 0, 2, 0, 3],
    );
  });

  it('returns an empty array for no items', () => {
    deepStrictEqual(
      intersperse([], () => 0),
      [],
    );
  });

  it('adds no separator around a single item', () => {
    deepStrictEqual(
      intersperse(['a'], () => ','),
      ['a'],
    );
  });

  it('calls the factory once per gap', () => {
    const [, first, , second] = intersperse(['a', 'b', 'c'], () => ({}));
    notStrictEqual(first, second);
  });
});
