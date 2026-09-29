import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSSE, type SSEMessage } from '../../../src/utils/sse/parse-sse.ts';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function parse(...chunks: string[]): Promise<SSEMessage[]> {
  return Array.fromAsync(parseSSE(streamOf(...chunks)));
}

describe('parseSSE', () => {
  it('reads events with their type and data', async () => {
    deepStrictEqual(await parse('event: text\ndata: Hello\n\ndata: plain\n\n'), [
      { event: 'text', data: 'Hello', id: '' },
      { event: 'message', data: 'plain', id: '' },
    ]);
  });

  it('joins multi-line data with a line feed', async () => {
    deepStrictEqual(await parse('data: a\ndata:b\ndata\n\n'), [
      { event: 'message', data: 'a\nb\n', id: '' },
    ]);
  });

  it('takes CRLF, LF and CR line endings', async () => {
    deepStrictEqual(await parse('data: a\r\n\r\ndata: b\r\rdata: c\n\n'), [
      { event: 'message', data: 'a', id: '' },
      { event: 'message', data: 'b', id: '' },
      { event: 'message', data: 'c', id: '' },
    ]);
  });

  it('reads lines and CRLFs split across chunks', async () => {
    deepStrictEqual(await parse('ev', 'ent: te', 'xt\r', '\ndata: x\r', '\n\r', '\n'), [
      { event: 'text', data: 'x', id: '' },
    ]);
  });

  it('reads a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: Kalimdor ✓\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    });
    deepStrictEqual(await Array.fromAsync(parseSSE(stream)), [
      { event: 'message', data: 'Kalimdor ✓', id: '' },
    ]);
  });

  it('skips comments and keeps only the first space of a value', async () => {
    deepStrictEqual(await parse(': ping\n\ndata:  two\n: note\n\n'), [
      { event: 'message', data: ' two', id: '' },
    ]);
  });

  it('carries the last id and retry to later events', async () => {
    deepStrictEqual(
      await parse('id: 1\nretry: 3000\ndata: a\n\ndata: b\n\nid\nretry: x\ndata: c\n\n'),
      [
        { event: 'message', data: 'a', id: '1', retry: 3000 },
        { event: 'message', data: 'b', id: '1', retry: 3000 },
        { event: 'message', data: 'c', id: '', retry: 3000 },
      ],
    );
  });

  it('ignores an id holding a NUL', async () => {
    deepStrictEqual(await parse('id: 1\n\nid: 2\0\ndata: a\n\n'), [
      { event: 'message', data: 'a', id: '1' },
    ]);
  });

  it('yields nothing for an event without data, and resets its type', async () => {
    deepStrictEqual(await parse('event: ping\n\ndata: a\n\n'), [
      { event: 'message', data: 'a', id: '' },
    ]);
  });

  it('drops an event the stream cuts off', async () => {
    deepStrictEqual(await parse('data: a\n\ndata: b\n'), [{ event: 'message', data: 'a', id: '' }]);
  });

  it('cancels the stream when the loop ends early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: tick\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const message of parseSSE(stream)) {
      strictEqual(message.data, 'tick');
      break;
    }
    strictEqual(cancelled, true);
  });

  it('rejects with the error of a failing stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('reset'));
      },
    });
    await rejects(Array.fromAsync(parseSSE(stream)), /reset/);
  });
});
