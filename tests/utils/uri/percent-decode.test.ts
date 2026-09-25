import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { percentDecode } from '../../../src/utils/index.ts';

describe('percentDecode', () => {
  it('decodes escapes as UTF-8 by default', () => {
    strictEqual(percentDecode('Jaina%20Proudmoore'), 'Jaina Proudmoore');
    strictEqual(percentDecode('%E2%82%AC%20rates'), '€ rates');
    strictEqual(percentDecode('%e2%82%ac'), '€');
    strictEqual(percentDecode('%F0%9F%90%BA'), '🐺');
  });

  it('leaves characters outside an escape as they are', () => {
    strictEqual(percentDecode('thrall'), 'thrall');
    strictEqual(percentDecode('a+b'), 'a+b');
    strictEqual(percentDecode('Jäina%20b'), 'Jäina b');
    strictEqual(percentDecode(''), '');
  });

  it('agrees with `decodeURIComponent` wherever it decodes', () => {
    const inputs = [
      'a%2Fb',
      '%25',
      '%3B%3D',
      'x%00y',
      '%C3%9Cbersicht',
      '%EF%BB%BFthrall',
      '%ED%9F%BF',
    ];
    for (const input of inputs) strictEqual(percentDecode(input), decodeURIComponent(input), input);
  });

  it('returns undefined wherever `decodeURIComponent` throws', () => {
    const inputs = [
      '%',
      '%z',
      '%zz',
      'a%2',
      '100%',
      '%FF',
      '%E4',
      '%C3',
      '%C0%AF',
      '%ED%A0%80',
      '%E2x%82%AC',
    ];
    for (const input of inputs) {
      let threw = false;
      try {
        decodeURIComponent(input);
      } catch {
        threw = true;
      }
      strictEqual(threw, true, input);
      strictEqual(percentDecode(input), undefined, input);
    }
  });

  it('decodes in the charset it is given', () => {
    strictEqual(percentDecode('J%E4ina', 'iso-8859-1'), 'Jäina');
    strictEqual(percentDecode('%A3%20rates', 'ISO-8859-1'), '£ rates');
    strictEqual(percentDecode('%E4', 'latin1'), 'ä');
    strictEqual(percentDecode('%C3%A4', 'UTF-8'), 'ä');
  });

  it('returns undefined for an unknown charset', () => {
    strictEqual(percentDecode('thrall', 'klingon'), undefined);
    strictEqual(percentDecode('%41', ''), undefined);
  });
});
