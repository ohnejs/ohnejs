import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decimalMarkIn } from '../../../src/utils/index.ts';

describe('decimalMarkIn', () => {
  it('gives `,` where the language writes a comma, else `.`', () => {
    strictEqual(decimalMarkIn('de'), ',');
    strictEqual(decimalMarkIn('fr'), ',');
    strictEqual(decimalMarkIn('en'), '.');
    strictEqual(decimalMarkIn('de-CH'), '.');
    strictEqual(decimalMarkIn('ar-EG'), '.');
  });
});
