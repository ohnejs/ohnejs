import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPort, MAX_PORT } from '../../../src/utils/index.ts';

describe('isPort', () => {
  it('returns true for integers in `[0, MAX_PORT]`', () => {
    strictEqual(isPort(0), true);
    strictEqual(isPort(3000), true);
    strictEqual(isPort(MAX_PORT), true);
  });

  it('returns false outside the range', () => {
    strictEqual(isPort(-1), false);
    strictEqual(isPort(MAX_PORT + 1), false);
  });

  it('returns false for non-integers and non-numbers', () => {
    strictEqual(isPort(3000.5), false);
    strictEqual(isPort(NaN), false);
    strictEqual(isPort('3000'), false);
    strictEqual(isPort(undefined), false);
  });
});
