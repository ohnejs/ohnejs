import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { minorUnitsToDecimal, parseMinorUnits } from '../../../src/utils/index.ts';

describe('minorUnitsToDecimal', () => {
  it('writes the major amount exactly', () => {
    strictEqual(minorUnitsToDecimal(1234, 2), '12.34');
    strictEqual(minorUnitsToDecimal(-5, 2), '-0.05');
    strictEqual(minorUnitsToDecimal(0, 3), '0.000');
    strictEqual(minorUnitsToDecimal(1234, 0), '1234');
    strictEqual(minorUnitsToDecimal(9007199254740991, 2), '90071992547409.91');
  });

  it('round-trips through `parseMinorUnits`', () => {
    for (const minor of [0, 1, -1, 99, 100, -12345, 9007199254740991]) {
      for (const digits of [0, 2, 3]) {
        strictEqual(parseMinorUnits(minorUnitsToDecimal(minor, digits), digits), minor);
      }
    }
  });
});
