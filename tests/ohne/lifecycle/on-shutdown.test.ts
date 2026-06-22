import { strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { onShutdown, useShutdown } from '../../../src/ohne/index.ts';

describe('onShutdown', () => {
  beforeEach(() => {
    useShutdown().clear();
  });

  it('registers a hook the coordinator runs', async () => {
    let ran = false;
    onShutdown(() => {
      ran = true;
    });

    await useShutdown().run();
    strictEqual(ran, true);
  });
});
