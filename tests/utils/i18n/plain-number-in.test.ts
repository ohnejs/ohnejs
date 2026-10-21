import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { plainNumberIn } from '../../../src/utils/index.ts';

describe('plainNumberIn', () => {
  it('writes a fraction with the language decimal mark', () => {
    strictEqual(plainNumberIn(0.1, 'de'), '0,1');
    strictEqual(plainNumberIn(-2.5, 'de'), '-2,5');
    strictEqual(plainNumberIn(0.1, 'en'), '0.1');
  });

  it('never groups or rounds', () => {
    strictEqual(plainNumberIn(12345, 'de'), '12345');
    strictEqual(plainNumberIn(1234.56789, 'de'), '1234,56789');
    strictEqual(plainNumberIn(1e21, 'de'), '1e+21');
  });
});
