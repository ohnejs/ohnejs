import { notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { shortUUID } from '../../../src/utils/uuid/short-uuid.ts';
import { uuidv7 } from '../../../src/utils/uuid/uuidv7.ts';

describe('shortUUID', () => {
  it('keeps the last eight hex characters', () => {
    strictEqual(shortUUID('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b'), '3e4f5a6b');
  });

  it('tells apart UUIDv7 ids that share a timestamp head', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const first = uuidv7();
    t.mock.timers.tick(1000);
    const second = uuidv7();
    strictEqual(first.slice(0, 8), second.slice(0, 8));
    notStrictEqual(shortUUID(first), shortUUID(second));
  });
});
