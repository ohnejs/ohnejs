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

  it('takes the ISO 4217 digits of a currency unless `decimals` is set', () => {
    strictEqual(formatNumber(12, { currency: 'HUF' }), 'HUF\u00a012.00');
    strictEqual(formatNumber(1234, { currency: 'JPY' }), '¥1,234');
    strictEqual(formatNumber(12.345, { currency: 'KWD', decimals: 1 }), 'KWD\u00a012.3');
  });

  it('signs a change and leaves zero unsigned', () => {
    strictEqual(formatNumber(0.23, { percent: true, signed: true }), '+23%');
    strictEqual(formatNumber(0, { percent: true, signed: true }), '0%');
  });

  it('fixes the decimals when asked', () => {
    strictEqual(formatNumber(3.14159, { decimals: 2 }), '3.14');
    strictEqual(formatNumber(12.5, { currency: 'EUR', decimals: 0 }), '€13');
  });

  it('writes a byte count in the unit that suits it', () => {
    strictEqual(formatNumber(512, { bytes: true }), '512 bytes');
    strictEqual(formatNumber(1536, { bytes: true }), '1.5 kB');
    strictEqual(formatNumber(8_400_000_000, { bytes: true }), '7.8 GB');
    strictEqual(formatNumber(1024 ** 2 - 1, { bytes: true }), '1 MB');
    strictEqual(formatNumber(-1536, { bytes: true }), '-1.5 kB');
  });

  it('pins a byte unit when named', () => {
    strictEqual(formatNumber(256 * 1024 ** 2, { bytes: 'gigabyte', decimals: 2 }), '0.25 GB');
    strictEqual(formatNumber(1024 ** 3, { bytes: 'megabyte' }), '1,024 MB');
  });
});
