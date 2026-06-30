import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatSSE } from '../../../src/utils/sse/format-sse.ts';

describe('formatSSE', () => {
  it('frames a single-line payload', () => {
    strictEqual(formatSSE('reload'), 'data: reload\n\n');
  });

  it('emits an event line before the data', () => {
    strictEqual(formatSSE('hi', { event: 'greet' }), 'event: greet\ndata: hi\n\n');
  });

  it('emits an id line before the data', () => {
    strictEqual(formatSSE('a\nb', { id: '1' }), 'id: 1\ndata: a\ndata: b\n\n');
  });

  it('splits every line of a multi-line payload onto its own data line', () => {
    strictEqual(formatSSE('one\ntwo\nthree'), 'data: one\ndata: two\ndata: three\n\n');
  });

  it('normalizes CRLF and CR line breaks to separate data lines', () => {
    strictEqual(formatSSE('a\r\nb\rc'), 'data: a\ndata: b\ndata: c\n\n');
  });

  it('orders event before id before data', () => {
    strictEqual(formatSSE('x', { event: 'tick', id: '7' }), 'event: tick\nid: 7\ndata: x\n\n');
  });
});
