import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { secureCompare } from '../../../src/utils/crypto/index.ts';

describe('secureCompare', () => {
  it('is true for equal strings', () => {
    strictEqual(secureCompare('a-token', 'a-token'), true);
  });

  it('is false for different strings of equal length', () => {
    strictEqual(secureCompare('a-token', 'b-token'), false);
  });

  it('is false for different lengths', () => {
    strictEqual(secureCompare('short', 'shorter'), false);
  });

  it('compares bytes, not string length', () => {
    strictEqual(secureCompare('é', 'e'), false);
  });
});
