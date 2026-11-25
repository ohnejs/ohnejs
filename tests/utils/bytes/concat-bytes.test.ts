import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { concatBytes } from '../../../src/utils/index.ts';

describe('concatBytes', () => {
  it('joins the parts in order', () => {
    deepStrictEqual(
      concatBytes(new Uint8Array([1]), new Uint8Array(), new Uint8Array([2, 3])),
      new Uint8Array([1, 2, 3]),
    );
    deepStrictEqual(concatBytes(), new Uint8Array());
  });
});
