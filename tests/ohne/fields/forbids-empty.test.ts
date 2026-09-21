import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { forbidsEmpty } from '../../../src/ohne/fields/forbids-empty.ts';

describe('forbidsEmpty', () => {
  it('holds under `allowEmpty: false`', () => {
    strictEqual(forbidsEmpty({ allowEmpty: false }), true);
  });

  it('holds under a `min` of at least 1', () => {
    strictEqual(forbidsEmpty({ min: 1 }), true);
    strictEqual(forbidsEmpty({ min: 3, allowEmpty: true }), true);
  });

  it('admits the empty list otherwise', () => {
    strictEqual(forbidsEmpty(undefined), false);
    strictEqual(forbidsEmpty({}), false);
    strictEqual(forbidsEmpty({ allowEmpty: true, min: 0, max: 2 }), false);
  });
});
