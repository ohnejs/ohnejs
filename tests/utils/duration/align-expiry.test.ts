import { ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { alignExpiry } from '../../../src/utils/index.ts';

describe('alignExpiry', () => {
  it('answers the end of the window after the one holding now', () => {
    strictEqual(alignExpiry(0, 1000), 2000);
    strictEqual(alignExpiry(1000, 1000), 3000);
    strictEqual(alignExpiry(1500, 1000), 3000);
    strictEqual(alignExpiry(1999, 1000), 3000);
    strictEqual(alignExpiry(2000, 1000), 4000);
  });

  it('mints one value anywhere inside a window and the next one a window later', () => {
    const window = 3_600_000;
    const start = 1_700_000_400_000 - (1_700_000_400_000 % window);
    strictEqual(alignExpiry(start, window), alignExpiry(start + window - 1, window));
    strictEqual(alignExpiry(start + window, window), alignExpiry(start, window) + window);
  });

  it('keeps every value alive for more than one window and at most two', () => {
    for (const now of [0, 1, 999, 1000, 1001, 123_456_789]) {
      const remaining = alignExpiry(now, 1000) - now;
      ok(remaining > 1000 && remaining <= 2000, `${now} lives ${remaining}`);
    }
  });

  it('throws for a window that is not a positive finite number', () => {
    throws(() => alignExpiry(1000, 0), /Invalid window/);
    throws(() => alignExpiry(1000, -1), /Invalid window/);
    throws(() => alignExpiry(1000, NaN), /Invalid window/);
    throws(() => alignExpiry(1000, Infinity), /Invalid window/);
  });
});
