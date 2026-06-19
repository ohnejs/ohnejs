import { ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { measure, sleep } from '../../../src/utils/index.ts';

describe('measure', () => {
  it('returns the function result', async () => {
    const { result } = await measure(() => 42);
    strictEqual(result, 42);
  });

  it('awaits async functions', async () => {
    const { result } = await measure(async () => {
      await sleep(0);
      return 'done';
    });
    strictEqual(result, 'done');
  });

  it('reports a non-negative elapsed time', async () => {
    const { ms } = await measure(() => undefined);
    ok(ms >= 0);
  });

  it('measures real elapsed time for slow work', async () => {
    const { ms } = await measure(() => sleep(20));
    ok(ms >= 15);
  });

  it('propagates a throw without swallowing it', async () => {
    await rejects(
      measure(() => {
        throw new Error('boom');
      }),
      /boom/,
    );
  });
});
