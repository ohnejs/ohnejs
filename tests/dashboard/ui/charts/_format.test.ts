import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import '../../_fake-dom.ts';

const { chartFormat } = await import('../../../../src/dashboard/ui/charts/_format.ts');

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

describe('chartFormat', () => {
  it('steps a byte axis by powers of 1024 in one unit', () => {
    const scale = chartFormat({ bytes: true }).scale(1_000_000_000, 4, true);
    deepStrictEqual(scale.labels, ['0 MB', '250 MB', '500 MB', '750 MB', '1,000 MB']);
    strictEqual(scale.max, 1000 * 1024 ** 2);
  });

  it('gives a byte tick the decimals its step needs', () => {
    const scale = chartFormat({ bytes: true }).scale(1.4 * 1024 ** 3, 3, true);
    deepStrictEqual(scale.labels, ['0.0 GB', '0.5 GB', '1.0 GB', '1.5 GB']);
  });

  it('keeps small percent ticks apart', () => {
    const scale = chartFormat({ percent: true, decimals: 1 }).scale(0.0003, 3, false);
    deepStrictEqual(scale.labels, ['0.00%', '0.01%', '0.02%', '0.03%']);
  });

  it('writes a value in full with the options as given', () => {
    strictEqual(chartFormat({ percent: true, decimals: 1 }).value(0.00012), '0.0%');
    strictEqual(chartFormat({ bytes: true }).value(1536), '1.5 kB');
  });

  it('pads currency ticks to the currency digits once a step has cents', () => {
    deepStrictEqual(chartFormat({ currency: 'EUR' }).scale(1, 4, false).labels, [
      '€0.00',
      '€0.25',
      '€0.50',
      '€0.75',
      '€1.00',
    ]);
    deepStrictEqual(chartFormat({ currency: 'EUR' }).scale(300, 3, true).labels, [
      '€0',
      '€100',
      '€200',
      '€300',
    ]);
  });

  it('goes compact from 1000 when omitted', () => {
    deepStrictEqual(chartFormat(undefined).scale(1500, 3, true).labels, ['0', '500', '1K', '1.5K']);
  });

  it('hands a function every tick as is', () => {
    deepStrictEqual(chartFormat((value) => `${value}x`).scale(3, 3, true).labels, [
      '0x',
      '1x',
      '2x',
      '3x',
    ]);
  });
});
