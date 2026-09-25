import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createPermits } from '../../../src/utils/index.ts';

describe('createPermits', () => {
  it('hands out permits up to the global limit', () => {
    const permits = createPermits(2);
    const release = permits.acquire();
    strictEqual(typeof release, 'function');
    strictEqual(typeof permits.acquire(), 'function');
    strictEqual(permits.acquire(), null);

    release!();
    strictEqual(typeof permits.acquire(), 'function');
    strictEqual(permits.acquire(), null);
  });

  it('caps each key at its own limit', () => {
    const permits = createPermits(8, 2);
    permits.acquire('thrall');
    const release = permits.acquire('thrall');
    strictEqual(permits.acquire('thrall'), null);
    strictEqual(typeof permits.acquire('jaina'), 'function');

    release!();
    strictEqual(typeof permits.acquire('thrall'), 'function');
    strictEqual(permits.acquire('thrall'), null);
  });

  it('lets the global limit bind across keys', () => {
    const permits = createPermits(3, 2);
    permits.acquire('thrall');
    permits.acquire('thrall');
    permits.acquire('jaina');
    strictEqual(permits.acquire('jaina'), null);
    strictEqual(permits.acquire('arthas'), null);
    strictEqual(permits.acquire(), null);
  });

  it('counts a keyless permit only against the global limit', () => {
    const permits = createPermits(3, 1);
    strictEqual(typeof permits.acquire(), 'function');
    strictEqual(typeof permits.acquire(), 'function');
    strictEqual(typeof permits.acquire('thrall'), 'function');
    strictEqual(permits.acquire('jaina'), null);
  });

  it('frees one slot however often a release is called', () => {
    const permits = createPermits(2, 2);
    const release = permits.acquire('thrall')!;
    permits.acquire('thrall');

    release();
    release();
    strictEqual(typeof permits.acquire('thrall'), 'function');
    strictEqual(permits.acquire('thrall'), null);
    strictEqual(permits.acquire(), null);
  });

  it('frees only the key that released', () => {
    const permits = createPermits(8, 1);
    const release = permits.acquire('thrall')!;
    permits.acquire('jaina');

    release();
    strictEqual(permits.acquire('jaina'), null);
    strictEqual(typeof permits.acquire('thrall'), 'function');
  });

  it('gives a key its full limit again once every permit is back', () => {
    const permits = createPermits(8, 2);
    for (let round = 0; round < 3; round++) {
      const releases = [permits.acquire('sylvanas')!, permits.acquire('sylvanas')!];
      strictEqual(permits.acquire('sylvanas'), null);
      for (const release of releases) release();
    }
  });

  it('refuses everything under a limit of zero', () => {
    strictEqual(createPermits(0).acquire(), null);
    strictEqual(createPermits(0, 2).acquire('thrall'), null);
    strictEqual(createPermits(8, 0).acquire('thrall'), null);
  });
});
