import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { instantToMs } from '../../../src/utils/index.ts';

describe('instantToMs', () => {
  it('reads epoch milliseconds and an ISO 8601 string', () => {
    strictEqual(instantToMs(1000), 1000);
    strictEqual(instantToMs('1970-01-01T00:00:01Z'), 1000);
  });

  it('gives `undefined` for anything that reads as neither', () => {
    for (const value of ['soon', Number.NaN, Infinity, undefined, null, {}]) {
      strictEqual(instantToMs(value), undefined, String(value));
    }
  });
});
