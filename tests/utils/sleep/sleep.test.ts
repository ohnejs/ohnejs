import { ok, rejects, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { sleep } from '../../../src/utils/index.ts';

describe('sleep', () => {
  it('resolves after the given number of milliseconds', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let resolved = false;
      const promise = sleep(100).then(() => {
        resolved = true;
      });

      mock.timers.tick(99);
      await Promise.resolve();
      strictEqual(resolved, false);

      mock.timers.tick(1);
      await promise;
      strictEqual(resolved, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('accepts a duration string', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let resolved = false;
      const promise = sleep('1s').then(() => {
        resolved = true;
      });

      mock.timers.tick(999);
      await Promise.resolve();
      strictEqual(resolved, false);

      mock.timers.tick(1);
      await promise;
      strictEqual(resolved, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('resolves to undefined', async () => {
    strictEqual(await sleep(0), undefined);
  });

  it('returns a Promise', () => {
    const result = sleep(0);
    ok(result instanceof Promise);
  });

  it('rejects an invalid duration string', async () => {
    await rejects(() => sleep('not a duration'), /Invalid duration/);
  });

  it('rejects a negative duration', async () => {
    await rejects(() => sleep(-1), /Invalid duration/);
  });
});
