import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { compact } from '../../../src/utils/index.ts';

describe('compact', () => {
  it('drops `false`, `null`, and `undefined`', () => {
    deepStrictEqual(compact(['a', false, 'b', null, undefined]), ['a', 'b']);
  });

  it('keeps the other falsy values', () => {
    deepStrictEqual(compact([0, '', Number.NaN, false]), [0, '', Number.NaN]);
  });

  it('returns an empty array for no items', () => {
    deepStrictEqual(compact([]), []);
  });
});
