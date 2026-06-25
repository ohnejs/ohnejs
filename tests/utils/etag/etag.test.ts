import { match, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { etag } from '../../../src/utils/etag/index.ts';

describe('etag', () => {
  it('builds a strong tag from string content', () => {
    strictEqual(etag('hello'), '"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"');
  });

  it('hashes bytes the same as the equivalent string', () => {
    strictEqual(etag(new TextEncoder().encode('hello')), etag('hello'));
  });

  it('counts the byte length of multibyte content in hex', () => {
    match(etag('é'), /^"2-/);
  });

  it('makes content weak only when asked', () => {
    strictEqual(etag('hello', { weak: true }), 'W/"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"');
  });

  it('builds a weak tag from stats', () => {
    strictEqual(etag({ size: 1024, mtime: new Date(0) }), 'W/"400-0"');
  });

  it('makes stats strong only when asked', () => {
    strictEqual(etag({ size: 1024, mtime: new Date(0) }, { weak: false }), '"400-0"');
  });
});
