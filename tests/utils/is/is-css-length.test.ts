import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isCSSLength } from '../../../src/utils/index.ts';

describe('isCSSLength', () => {
  it('accepts a number with a length unit or a percent sign', () => {
    strictEqual(isCSSLength('320px'), true);
    strictEqual(isCSSLength('2.5rem'), true);
    strictEqual(isCSSLength('50%'), true);
    strictEqual(isCSSLength('0vmin'), true);
  });

  it('rejects keywords, unitless numbers, and negatives', () => {
    strictEqual(isCSSLength('auto'), false);
    strictEqual(isCSSLength('12'), false);
    strictEqual(isCSSLength('-1rem'), false);
    strictEqual(isCSSLength('calc(100% - 1rem)'), false);
  });

  it('rejects non-strings', () => {
    strictEqual(isCSSLength(320), false);
    strictEqual(isCSSLength(undefined), false);
  });
});
