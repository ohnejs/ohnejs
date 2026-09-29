import { notStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { RateLimitStore } from '../../../src/utils/index.ts';

import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useConfig } from '../../../src/ohne/layers/use-config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import {
  closeRateLimitStore,
  resolveRateLimitStore,
} from '../../../src/ohne/rate-limit/_resolve-rate-limit-store.ts';
import { useRateLimitStore } from '../../../src/ohne/rate-limit/use-rate-limit-store.ts';
import { useRateLimitStores } from '../../../src/ohne/rate-limit/use-rate-limit-stores.ts';

const LAYERS = ['/rate-limit-store-base', '/rate-limit-store-app'];

useLayers().add({ path: '/rate-limit-store-defaults', defaults: DEFAULTS, input: {} });

function counting(): RateLimitStore & { closed: number } {
  return {
    closed: 0,
    async take() {
      return 7;
    },
    async reset() {},
    async close() {
      this.closed++;
    },
  };
}

function select(api: Record<string, unknown>): void {
  useLayers().add({ path: LAYERS[1], input: { api } });
}

describe('useRateLimitStore', () => {
  afterEach(() => {
    for (const path of LAYERS) useLayers().remove(path);
    useRateLimitStores().delete('counting');
  });

  it('counts in memory by default', async () => {
    const store = resolveRateLimitStore();
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 0);
    ok((await store.take('thrall', { limit: 1, window: 1000 })) > 0);
  });

  it('builds one store per config, and a fresh one when the config changes', () => {
    const first = resolveRateLimitStore();
    strictEqual(resolveRateLimitStore(), first);
    select({ rateLimitStore: 'memory' });
    notStrictEqual(resolveRateLimitStore(), first);
  });

  it('delegates to the store the current config selects', async () => {
    const store = useRateLimitStore();
    useRateLimitStores().register('counting', counting);
    select({ rateLimitStore: 'counting' });
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 7);
  });

  it('charges on the selected store, and has no `charge` when that store lacks one', async () => {
    const store = useRateLimitStore();
    strictEqual(await store.charge!('thrall', { limit: 1, window: 1000 }, 3), 3000);
    useRateLimitStores().register('counting', counting);
    select({ rateLimitStore: 'counting' });
    strictEqual(store.charge, undefined);
  });

  it('closes only a store that was built', async () => {
    useRateLimitStores().register('counting', counting);
    select({ rateLimitStore: 'counting' });
    await closeRateLimitStore();
    const store = resolveRateLimitStore() as ReturnType<typeof counting>;
    await closeRateLimitStore();
    strictEqual(store.closed, 1);
  });

  it('throws for a store nothing registered', () => {
    select({ rateLimitStore: 'redis' });
    throws(() => resolveRateLimitStore(), { title: 'Unknown rate-limit store `redis`' });
  });

  it('throws for the database store without a helper database', () => {
    select({ rateLimitStore: 'database' });
    throws(() => resolveRateLimitStore(), /needs a helper database/);
  });

  it("keeps a dependency layer's store choice from reaching the app", () => {
    useLayers().add({ path: LAYERS[0], input: { api: { rateLimitStore: 'database' } } });
    select({});
    strictEqual(useConfig().api.rateLimitStore, undefined);
  });
});
