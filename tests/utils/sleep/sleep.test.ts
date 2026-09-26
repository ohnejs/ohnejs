import { ok, rejects, strictEqual } from 'node:assert';
import { getEventListeners } from 'node:events';
import { describe, it, mock } from 'node:test';

import { sleep } from '../../../src/utils/index.ts';

/**
 * The number of timers keeping the process alive.
 */
function activeTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

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

  it('waits a duration past the 32-bit timer wall in full', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let resolved = false;
      const promise = sleep('25d').then(() => {
        resolved = true;
      });

      mock.timers.tick(2_147_483_647);
      await Promise.resolve();
      strictEqual(resolved, false);

      mock.timers.tick(12_516_352);
      await Promise.resolve();
      strictEqual(resolved, false);

      mock.timers.tick(1);
      await promise;
      strictEqual(resolved, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('resolves when its signal never aborts, leaving no listener on it', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { signal } = new AbortController();
      const promise = sleep(100, { signal });
      strictEqual(getEventListeners(signal, 'abort').length, 1);
      mock.timers.tick(100);
      strictEqual(await promise, undefined);
      strictEqual(getEventListeners(signal, 'abort').length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('rejects at once with the reason of a signal already aborted, arming no timer', async () => {
    const reason = new Error('Arthas turned');
    const timers = activeTimers();
    const promise = sleep('10s', { signal: AbortSignal.abort(reason) });
    strictEqual(activeTimers(), timers);
    await rejects(promise, (error) => error === reason);
  });

  it('rejects with the reason once its signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const promise = sleep('10s', { signal: controller.signal });
    controller.abort('Jaina left');
    await rejects(promise, (error) => error === 'Jaina left');
  });

  it('clears its timer on abort, so the process can exit', async () => {
    const controller = new AbortController();
    const timers = activeTimers();
    const promise = sleep('10s', { signal: controller.signal });
    strictEqual(activeTimers(), timers + 1);
    controller.abort();
    await rejects(promise);
    strictEqual(activeTimers(), timers);
  });
});
