import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { uuidv7Time } from '../../../src/utils/uuid/uuidv7-time.ts';
import { uuidv7 } from '../../../src/utils/uuid/uuidv7.ts';

describe('uuidv7Time', () => {
  it('reads the timestamp from the first 48 bits', () => {
    strictEqual(uuidv7Time('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b'), 1783419800365);
  });

  it('round-trips the moment a UUIDv7 is minted', () => {
    const before = Date.now();
    const time = uuidv7Time(uuidv7());
    ok(time >= before && time <= Date.now());
  });

  it('reads a non-hex value as NaN', () => {
    ok(Number.isNaN(uuidv7Time('not-a-uuid')));
  });
});
