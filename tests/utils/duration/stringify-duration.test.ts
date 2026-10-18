import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseDuration, stringifyDuration } from '../../../src/utils/index.ts';

describe('stringifyDuration', () => {
  it('writes units greedily, leaving zero units out', () => {
    strictEqual(stringifyDuration(5_400_000), '1h 30m');
    strictEqual(stringifyDuration(90_061_001), '1d 1h 1m 1s 1ms');
    strictEqual(stringifyDuration(86_400_000 * 400), '400d');
  });

  it('writes zero as `0ms`', () => {
    strictEqual(stringifyDuration(0), '0ms');
  });

  it('reads back through `parseDuration` exactly', () => {
    for (const ms of [1, 999, 60_000, 3_723_004, Number.MAX_SAFE_INTEGER]) {
      strictEqual(parseDuration(stringifyDuration(ms)), ms);
    }
  });

  it('throws on a negative, fractional or unsafe value', () => {
    for (const ms of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN])
      throws(() => stringifyDuration(ms));
  });
});
