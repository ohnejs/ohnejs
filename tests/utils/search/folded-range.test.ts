import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { foldedRange } from '../../../src/utils/search/folded-range.ts';

describe('foldedRange', () => {
  it('points at the original letters a folded needle matches', () => {
    deepStrictEqual(foldedRange('Crème brûlée', 'brul'), [6, 9]);
    deepStrictEqual(foldedRange('Café', 'CAFE'), [0, 3]);
  });

  it('covers a letter the fold widens', () => {
    deepStrictEqual(foldedRange('Straße', 'strass'), [0, 4]);
  });

  it('answers `undefined` for a miss or an empty needle', () => {
    strictEqual(foldedRange('Café', 'tea'), undefined);
    strictEqual(foldedRange('Café', ''), undefined);
  });
});
