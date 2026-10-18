import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { numericInputMode } from '../../../src/utils/index.ts';

describe('numericInputMode', () => {
  it('picks the digit pad for a non-negative `min`', () => {
    strictEqual(numericInputMode(0), 'numeric');
    strictEqual(numericInputMode(1), 'numeric');
  });

  it('picks the decimal pad when decimals are allowed', () => {
    strictEqual(numericInputMode(0, true), 'decimal');
  });

  it('keeps the full keyboard when the value can go negative', () => {
    strictEqual(numericInputMode(-1), undefined);
    strictEqual(numericInputMode(-0.5, true), undefined);
  });

  it('keeps the full keyboard without a `min`', () => {
    strictEqual(numericInputMode(undefined), undefined);
    strictEqual(numericInputMode(undefined, true), undefined);
  });
});
