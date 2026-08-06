import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { batchedEffect } from '../../../src/utils/reactive/batched-effect.ts';
import { nextTick } from '../../../src/utils/reactive/next-tick.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

describe('nextTick', () => {
  it('resolves after pending batched re-runs have flushed', async () => {
    const count = ref(0);
    let seen = -1;
    batchedEffect(() => {
      seen = count.value;
    });
    count.value = 1;
    strictEqual(seen, 0);
    await nextTick();
    strictEqual(seen, 1);
  });

  it('resolves with nothing pending', async () => {
    await nextTick();
  });

  it('coalesces many writes into the one flush it awaits', async () => {
    const count = ref(0);
    let runs = 0;
    batchedEffect(() => {
      void count.value;
      runs += 1;
    });
    count.value = 1;
    count.value = 2;
    count.value = 3;
    await nextTick();
    strictEqual(runs, 2);
    strictEqual(count.value, 3);
  });
});
