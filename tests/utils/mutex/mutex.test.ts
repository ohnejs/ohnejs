import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createMutex } from '../../../src/utils/mutex/mutex.ts';

const tick = () => Promise.resolve();

describe('createMutex', () => {
  it('runs tasks one at a time, in call order', async () => {
    const lock = createMutex();
    const log: string[] = [];
    const task = (id: string) => async () => {
      log.push(`start-${id}`);
      await tick();
      await tick();
      log.push(`end-${id}`);
    };
    await Promise.all([lock(task('a')), lock(task('b')), lock(task('c'))]);
    deepStrictEqual(log, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });

  it('returns each task its own result', async () => {
    const lock = createMutex();
    strictEqual(await lock(async () => 41 + 1), 42);
  });

  it('rejects to the caller without stalling the next task', async () => {
    const lock = createMutex();
    const failing = lock(async () => {
      throw new Error('boom');
    });
    const next = lock(async () => 'ran');
    await rejects(failing, /boom/);
    strictEqual(await next, 'ran');
  });

  it('starts a task only after the previous one settles', async () => {
    const lock = createMutex();
    const log: string[] = [];
    let releaseFirst!: () => void;
    const first = lock(
      () =>
        new Promise<void>((resolve) => {
          log.push('first-in');
          releaseFirst = resolve;
        }),
    );
    const second = lock(async () => {
      log.push('second-in');
    });
    await tick();
    deepStrictEqual(log, ['first-in']);
    releaseFirst();
    await Promise.all([first, second]);
    deepStrictEqual(log, ['first-in', 'second-in']);
  });
});
