import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { limitStream } from '../../../src/utils/index.ts';

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

/**
 * A stream that never ends, recording the reason it was cancelled with.
 */
function endless(): { stream: ReadableStream<Uint8Array>; cancelled: () => unknown } {
  let cancelled: unknown;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => controller.enqueue(new Uint8Array(3)),
    cancel: (reason) => void (cancelled = reason),
  });
  return { stream, cancelled: () => cancelled };
}

/**
 * Reads `stream` to its end, decoding each chunk on its own.
 */
async function texts(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const parts = await Array.fromAsync(stream);
  return parts.map((part) => new TextDecoder().decode(part));
}

describe('limitStream', () => {
  it('passes a stream at the cap through whole', async () => {
    const { stream, cancelled } = source('ab', 'cd');
    let calls = 0;
    deepStrictEqual(await texts(limitStream(stream, 4, () => calls++)), ['ab', 'cd']);
    strictEqual(calls, 0);
    strictEqual(cancelled(), undefined);
  });

  it("errors with `onExceed`'s value once the cap is crossed", async () => {
    const tooLarge = new RangeError('Thrall sent too much');
    const body = limitStream(source('ab', 'cd', 'e').stream, 4, () => tooLarge);
    await rejects(texts(body), (error) => error === tooLarge);
  });

  it('never forwards the chunk that crosses the cap', async () => {
    const reader = limitStream(source('ab', 'cdef').stream, 4, () => 'over').getReader();
    deepStrictEqual(await reader.read(), { done: false, value: new TextEncoder().encode('ab') });
    await rejects(reader.read(), (error) => error === 'over');
  });

  it('counts bytes, not characters', async () => {
    await rejects(
      texts(limitStream(source('Jaina ❄').stream, 7, () => 'over')),
      (e) => e === 'over',
    );
  });

  it('cancels the source with the same value', async () => {
    const { stream, cancelled } = endless();
    await rejects(texts(limitStream(stream, 10, () => 'over')), (error) => error === 'over');
    strictEqual(cancelled(), 'over');
  });

  it('calls `onExceed` once', async () => {
    let calls = 0;
    const body = limitStream(source('abc', 'def', 'ghi').stream, 2, () => ++calls);
    await rejects(texts(body), (error) => error === 1);
    strictEqual(calls, 1);
  });

  it('cancels the source when the consumer cancels', async () => {
    const { stream, cancelled } = endless();
    await limitStream(stream, 10, () => 'over').cancel('Arthas left');
    await setImmediate();
    strictEqual(cancelled(), 'Arthas left');
  });

  it('with a cap of zero, passes only an empty stream', async () => {
    deepStrictEqual(await texts(limitStream(source('', '').stream, 0, () => 'over')), ['', '']);
    await rejects(texts(limitStream(source('a').stream, 0, () => 'over')), (e) => e === 'over');
  });
});
