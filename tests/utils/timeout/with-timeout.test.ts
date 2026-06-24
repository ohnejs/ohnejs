import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sleep, withTimeout } from '../../../src/utils/index.ts';

describe('withTimeout', () => {
  it('resolves with the promise value when it settles first', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 50, () => 'late');
    strictEqual(value, 'ok');
  });

  it('resolves with onTimeout when the deadline passes first', async () => {
    const slow = sleep(50).then(() => 'ok');
    const value = await withTimeout(slow, 5, () => 'late');
    strictEqual(value, 'late');
  });

  it('rejects when the promise rejects before the deadline', async () => {
    await rejects(
      withTimeout(Promise.reject(new Error('boom')), 50, () => 'late'),
      /boom/,
    );
  });

  it('does not surface a rejection that arrives after the deadline', async () => {
    const slow = sleep(20).then(() => {
      throw new Error('late boom');
    });
    const value = await withTimeout(slow, 5, () => 'fallback');
    strictEqual(value, 'fallback');
    await sleep(30);
  });
});
