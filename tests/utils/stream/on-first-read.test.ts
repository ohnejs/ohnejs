import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { onFirstRead } from '../../../src/utils/index.ts';

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

describe('onFirstRead', () => {
  it('calls back once, on the first read, not when wrapped', async () => {
    let calls = 0;
    const body = onFirstRead(source('Jaina ', 'Proudmoore').stream, () => calls++);
    await setImmediate();
    strictEqual(calls, 0);
    strictEqual(await new Response(body).text(), 'Jaina Proudmoore');
    strictEqual(calls, 1);
  });

  it(
    'calls back before it reads the source, so a source waiting on it flows',
    { timeout: 5000 },
    async () => {
      const { promise: called, resolve } = Promise.withResolvers<void>();
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            await called;
            controller.enqueue(new TextEncoder().encode('Thrall'));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const { value } = await onFirstRead(stream, resolve).getReader().read();
      strictEqual(new TextDecoder().decode(value), 'Thrall');
    },
  );

  it('passes a source error through', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new RangeError('Arthas fell')),
    });
    await rejects(new Response(onFirstRead(stream, () => {})).text(), RangeError);
  });

  it('cancels the source with the reason, never calling back', async () => {
    const { stream, cancelled } = source('Sylvanas');
    let calls = 0;
    await onFirstRead(stream, () => calls++).cancel('Illidan left');
    strictEqual(cancelled(), 'Illidan left');
    strictEqual(calls, 0);
  });
});
