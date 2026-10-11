import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import '../_fake-dom.ts';

const { formatNumber } = await import('../../../src/dashboard/runtime/number.ts');

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

describe('formatNumber', () => {
  it('writes a number in full by default', () => {
    strictEqual(formatNumber(12904), '12,904');
  });

  it('shortens to one decimal when compact', () => {
    strictEqual(formatNumber(12904, { compact: true }), '12.9K');
    strictEqual(formatNumber(12000, { compact: true }), '12K');
  });

  it('formats currency and percent', () => {
    strictEqual(formatNumber(1290000, { currency: 'EUR', compact: true }), '€1.3M');
    strictEqual(formatNumber(12.5, { currency: 'EUR' }), '€12.50');
    strictEqual(formatNumber(0.042, { percent: true, decimals: 1 }), '4.2%');
  });

  it('signs a change and leaves zero unsigned', () => {
    strictEqual(formatNumber(0.23, { percent: true, signed: true }), '+23%');
    strictEqual(formatNumber(0, { percent: true, signed: true }), '0%');
  });

  it('fixes the decimals when asked', () => {
    strictEqual(formatNumber(3.14159, { decimals: 2 }), '3.14');
    strictEqual(formatNumber(12.5, { currency: 'EUR', decimals: 0 }), '€13');
  });
});
