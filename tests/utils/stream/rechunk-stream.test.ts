import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { rechunkStream } from '../../../src/utils/index.ts';

/**
 * A stream of the given chunks, recording whether it was cancelled.
 */
function source(...chunks: string[]): {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  const queue = chunks.map((chunk) => new TextEncoder().encode(chunk));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function texts(stream: ReadableStream<Uint8Array>, size: number): Promise<string[]> {
  const parts = await Array.fromAsync(rechunkStream(stream, size));
  return parts.map((part) => new TextDecoder().decode(part));
}

describe('rechunkStream', () => {
  it('joins small chunks into exact sizes, the last one shorter', async () => {
    deepStrictEqual(await texts(source('ab', 'c', 'defg', 'h').stream, 3), ['abc', 'def', 'gh']);
  });

  it('splits a chunk larger than the size', async () => {
    deepStrictEqual(await texts(source('abcdefgh').stream, 3), ['abc', 'def', 'gh']);
  });

  it('ends on a full chunk without an empty tail', async () => {
    deepStrictEqual(await texts(source('abc', 'def').stream, 3), ['abc', 'def']);
  });

  it('yields nothing for an empty stream', async () => {
    deepStrictEqual(await texts(source().stream, 3), []);
    deepStrictEqual(await texts(source('', '').stream, 3), []);
  });

  it('yields a fresh buffer for every chunk', async () => {
    const parts = await Array.fromAsync(rechunkStream(source('abcdef').stream, 3));
    strictEqual(parts[0]!.buffer === parts[1]!.buffer, false);
  });

  it('allocates each chunk at the length of its bytes', async () => {
    const parts = await Array.fromAsync(rechunkStream(source('ab', 'cd').stream, 8 * 1024 ** 2));
    strictEqual(parts.length, 1);
    strictEqual(parts[0]!.buffer.byteLength, 4);
  });

  it('cancels the source when the loop ends early', async () => {
    const { stream, cancelled } = source('abc', 'def', 'ghi');
    for await (const part of rechunkStream(stream, 3)) {
      strictEqual(part.byteLength, 3);
      break;
    }
    strictEqual(cancelled(), true);
  });

  it('leaves a finished source uncancelled', async () => {
    const { stream, cancelled } = source('abc');
    await texts(stream, 2);
    strictEqual(cancelled(), false);
  });

  it('rejects a size below 1', async () => {
    await rejects(texts(source('abc').stream, 0), /Invalid chunk size: 0/);
  });

  it('rethrows a source error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('reset'));
      },
    });
    await rejects(texts(stream, 3), /reset/);
  });
});
