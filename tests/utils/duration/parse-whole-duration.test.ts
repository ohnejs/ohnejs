import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseWholeDuration } from '../../../src/utils/index.ts';

describe('parseWholeDuration', () => {
  it('reads duration text, commas included', () => {
    strictEqual(parseWholeDuration('1h 30m'), 5_400_000);
    strictEqual(parseWholeDuration('1 hour, 30 minutes'), 5_400_000);
    strictEqual(parseWholeDuration(' 90m '), 5_400_000);
  });

  it('rounds to the nearest millisecond', () => {
    strictEqual(parseWholeDuration('0.07h'), 252_000);
    strictEqual(parseWholeDuration('0.5ms'), 1);
  });

  it('takes `0` alone among bare numbers', () => {
    strictEqual(parseWholeDuration('0'), 0);
    strictEqual(parseWholeDuration('90'), undefined);
    strictEqual(parseWholeDuration('1.5'), undefined);
  });

  it('passes a whole, non-negative number through', () => {
    strictEqual(parseWholeDuration(5_400_000), 5_400_000);
    strictEqual(parseWholeDuration(-1), undefined);
    strictEqual(parseWholeDuration(1.5), undefined);
  });

  it('gives `undefined` for what names no duration', () => {
    for (const input of ['2 Stunden', '-1h', '', null, undefined, {}, '99999999999999999d']) {
      strictEqual(parseWholeDuration(input), undefined, String(input));
    }
  });
});
