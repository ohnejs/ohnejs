import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createMemoryRateLimitStore } from '../../../src/utils/index.ts';
import { storeContract } from './_store-contract.ts';

describe('createMemoryRateLimitStore', () => {
  storeContract(async () => {
    const clock = { now: 1_800_000_000_000 };
    return { clock, store: createMemoryRateLimitStore({ now: () => clock.now }) };
  });

  it('keeps a limited key limited through a flood of other keys', async () => {
    const clock = { now: 0 };
    const store = createMemoryRateLimitStore({ now: () => clock.now });
    const rate = { limit: 1, window: 60_000 };
    await store.take('thrall', rate);
    for (let i = 0; i < 10_000; i++) {
      clock.now = i;
      await store.take(`orc-${i}`, rate);
    }
    strictEqual((await store.take('thrall', rate)) > 0, true);
  });
});
