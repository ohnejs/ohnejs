import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isoTimeToMs, msToISOTime } from '../../../src/utils/index.ts';

describe('isoTimeToMs', () => {
  it('reads `HH:MM` and `HH:MM:SS` into the day', () => {
    strictEqual(isoTimeToMs('09:30'), 34_200_000);
    strictEqual(isoTimeToMs('09:30:00'), 34_200_000);
    strictEqual(isoTimeToMs('23:59:59'), 86_399_000);
  });

  it('gives `undefined` for `24:00` and malformed text', () => {
    for (const value of ['24:00', '9:30', '09:60', ''])
      strictEqual(isoTimeToMs(value), undefined, value);
  });
});

describe('msToISOTime', () => {
  it('writes the full `HH:MM:SS` form', () => {
    strictEqual(msToISOTime(34_200_000), '09:30:00');
    strictEqual(msToISOTime(isoTimeToMs('23:59:59')!), '23:59:59');
  });
});
