import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { linePath } from '../../../src/utils/index.ts';

const x = (index: number): number => index * 10;
const y = (value: number): number => 10 - value;

describe('linePath', () => {
  it('runs through every value', () => {
    strictEqual(linePath([1, 2, 3], x, y), 'M0,9L10,8L20,7');
  });

  it('breaks at a null and starts again after it', () => {
    strictEqual(linePath([1, 2, null, 4, 5], x, y), 'M0,9L10,8M30,6L40,5');
  });

  it('draws nothing for a value alone between gaps', () => {
    strictEqual(linePath([null, 1, null], x, y), '');
    strictEqual(linePath([4], x, y), '');
    strictEqual(linePath([], x, y), '');
  });

  it('leaves out the steps `joins` refuses', () => {
    strictEqual(
      linePath([1, 2, 3, 4], x, y, { joins: (index) => index !== 1 }),
      'M0,9L10,8M20,7L30,6',
    );
  });

  it('closes each run down to the baseline as an area', () => {
    strictEqual(linePath([1, 2], x, y, { baseline: 10 }), 'M0,9L10,8L10,10L0,10Z');
    strictEqual(
      linePath([1, 2, null, 4, 5], x, y, { baseline: 10 }),
      'M0,9L10,8L10,10L0,10ZM30,6L40,5L40,10L30,10Z',
    );
  });
});
