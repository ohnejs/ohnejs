import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, isFresh, runWithEvent } from '../../../src/ohne/index.ts';

function makeEvent(reqHeaders: Record<string, string>, resHeaders: Record<string, string>): Event {
  return {
    request: new Request('http://localhost/', { headers: new Headers(reqHeaders) }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers(resHeaders) },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

function fresh(reqHeaders: Record<string, string>, resHeaders: Record<string, string>): boolean {
  return runWithEvent(makeEvent(reqHeaders, resHeaders), () => isFresh());
}

describe('isFresh', () => {
  it('is stale without any validator', () => {
    strictEqual(fresh({}, { etag: '"a"' }), false);
  });

  it('is fresh on a matching If-None-Match', () => {
    strictEqual(fresh({ 'if-none-match': '"a"' }, { etag: '"a"' }), true);
  });

  it('is stale on a non-matching If-None-Match', () => {
    strictEqual(fresh({ 'if-none-match': '"a"' }, { etag: '"b"' }), false);
  });

  it('matches an entry within a list', () => {
    strictEqual(fresh({ 'if-none-match': '"a", "b", "c"' }, { etag: '"b"' }), true);
  });

  it('compares weakly, ignoring the W/ prefix in either position', () => {
    strictEqual(fresh({ 'if-none-match': 'W/"a"' }, { etag: '"a"' }), true);
    strictEqual(fresh({ 'if-none-match': '"a"' }, { etag: 'W/"a"' }), true);
  });

  it('treats * as matching any current representation', () => {
    strictEqual(fresh({ 'if-none-match': '*' }, { etag: '"a"' }), true);
  });

  it('is stale when If-None-Match is set but no ETag is present', () => {
    strictEqual(fresh({ 'if-none-match': '"a"' }, {}), false);
  });

  it('is fresh when Last-Modified is not after If-Modified-Since', () => {
    strictEqual(
      fresh(
        { 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
        { 'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT' },
      ),
      true,
    );
  });

  it('is stale when Last-Modified is after If-Modified-Since', () => {
    strictEqual(
      fresh(
        { 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
        { 'last-modified': 'Wed, 21 Oct 2015 08:00:00 GMT' },
      ),
      false,
    );
  });

  it('decides on If-None-Match and ignores If-Modified-Since', () => {
    strictEqual(
      fresh(
        { 'if-none-match': '"a"', 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
        { etag: '"a"', 'last-modified': 'Wed, 21 Oct 2015 08:00:00 GMT' },
      ),
      true,
    );
  });

  it('is stale on a no-cache request', () => {
    strictEqual(
      fresh({ 'if-none-match': '"a"', 'cache-control': 'no-cache' }, { etag: '"a"' }),
      false,
    );
  });

  it('reads the no-cache directive case-insensitively', () => {
    strictEqual(
      fresh({ 'if-none-match': '"a"', 'cache-control': 'max-age=0, No-Cache' }, { etag: '"a"' }),
      false,
    );
  });
});
