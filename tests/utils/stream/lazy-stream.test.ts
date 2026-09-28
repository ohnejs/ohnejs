import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { lazyStream } from '../../../src/utils/index.ts';

/**
 * A stream of the given chunks, recording the reason it was cancelled with.
 */
function source(...chunks: string[]): {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => unknown;
} {
  let cancelled: unknown;
  const queue = chunks.map((chunk) => new TextEncoder().encode(chunk));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel(reason) {
      cancelled = reason;
    },
  });
  return { stream, cancelled: () => cancelled };
}

describe('lazyStream', () => {
  it('opens the source once, on the first read, not when wrapped', async () => {
    let opens = 0;
    const body = lazyStream(() => {
      opens++;
      return source('Jaina ', 'Proudmoore').stream;
    });
    await setImmediate();
    strictEqual(opens, 0);
    strictEqual(await new Response(body).text(), 'Jaina Proudmoore');
    strictEqual(opens, 1);
  });

  it('passes a source error through', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new RangeError('Arthas fell')),
    });
    await rejects(new Response(lazyStream(() => stream)).text(), RangeError);
  });

  it('cancels an opened source with the reason', async () => {
    const { stream, cancelled } = source('Sylvanas', 'Windrunner');
    const reader = lazyStream(() => stream).getReader();
    await reader.read();
    await reader.cancel('Illidan left');
    strictEqual(cancelled(), 'Illidan left');
  });

  it('never opens the source when cancelled unread', async () => {
    let opens = 0;
    await lazyStream(() => {
      opens++;
      return source('Thrall').stream;
    }).cancel('Illidan left');
    strictEqual(opens, 0);
  });
});
