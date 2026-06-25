import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { Event } from '../../../src/ohne/index.ts';

import { cors } from '../../../src/ohne/index.ts';

function event(method: string, headers: Record<string, string>): Event {
  return {
    request: new Request('http://localhost/', { method, headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('cors', () => {
  it('allows a listed origin and appends Vary: Origin', () => {
    const e = event('GET', { origin: 'https://app.example.com' });
    cors({ origin: 'https://app.example.com' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), 'https://app.example.com');
    strictEqual(e.response.headers.get('vary'), 'Origin');
  });

  it('ignores a request without an Origin, and a wildcard policy adds no Vary', () => {
    const e = event('GET', {});
    cors({ origin: '*' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), null);
    strictEqual(e.response.headers.get('vary'), null);
  });

  it('gives an unlisted origin no CORS headers but still varies on Origin', () => {
    const e = event('GET', { origin: 'https://evil.com' });
    cors({ origin: 'https://app.example.com' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), null);
    strictEqual(e.response.headers.get('vary'), 'Origin');
  });

  it('varies on Origin under a non-wildcard policy even with no Origin', () => {
    const e = event('GET', {});
    cors({ origin: 'https://app.example.com' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), null);
    strictEqual(e.response.headers.get('vary'), 'Origin');
  });

  it('matches origins exactly, not by substring', () => {
    const e = event('GET', { origin: 'https://app.example.com.evil.com' });
    cors({ origin: 'https://app.example.com' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), null);
  });

  it('matches any origin in the list', () => {
    const mw = cors({ origin: ['https://a.com', 'https://b.com'] });
    const e = event('GET', { origin: 'https://b.com' });
    mw(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), 'https://b.com');
  });

  it('echoes * for a wildcard origin and adds no Vary', () => {
    const e = event('GET', { origin: 'https://anything.com' });
    cors({ origin: '*' })(e);
    strictEqual(e.response.headers.get('access-control-allow-origin'), '*');
    strictEqual(e.response.headers.get('vary'), null);
  });

  it('sets credentials for an allowed origin', () => {
    const e = event('GET', { origin: 'https://app.example.com' });
    cors({ origin: 'https://app.example.com', credentials: true })(e);
    strictEqual(e.response.headers.get('access-control-allow-credentials'), 'true');
  });

  it('throws when a wildcard origin is combined with credentials', () => {
    throws(() => cors({ origin: '*', credentials: true }), /credentials/);
  });

  it('merges Vary: Origin with an existing Vary value', () => {
    const e = event('GET', { origin: 'https://a.com' });
    e.response.headers.set('vary', 'Accept');
    cors({ origin: 'https://a.com' })(e);
    strictEqual(e.response.headers.get('vary'), 'Accept, Origin');
  });

  it('exposes the configured response headers', () => {
    const e = event('GET', { origin: 'https://a.com' });
    cors({ origin: 'https://a.com', exposeHeaders: ['X-Total-Count'] })(e);
    strictEqual(e.response.headers.get('access-control-expose-headers'), 'X-Total-Count');
  });

  it('answers a preflight with 204 and the default methods, reflecting requested headers', () => {
    const e = event('OPTIONS', {
      origin: 'https://app.example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, x-custom',
    });
    const result = cors({ origin: 'https://app.example.com' })(e);
    strictEqual(result, null);
    strictEqual(e.response.status, 204);
    strictEqual(
      e.response.headers.get('access-control-allow-methods'),
      'GET, HEAD, PUT, PATCH, POST, DELETE',
    );
    strictEqual(e.response.headers.get('access-control-allow-headers'), 'content-type, x-custom');
  });

  it('honors explicit methods, allowHeaders, and maxAge on a preflight', () => {
    const e = event('OPTIONS', {
      origin: 'https://a.com',
      'access-control-request-method': 'PUT',
    });
    cors({
      origin: 'https://a.com',
      methods: ['GET', 'PUT'],
      allowHeaders: ['X-Token'],
      maxAge: 600,
    })(e);
    strictEqual(e.response.headers.get('access-control-allow-methods'), 'GET, PUT');
    strictEqual(e.response.headers.get('access-control-allow-headers'), 'X-Token');
    strictEqual(e.response.headers.get('access-control-max-age'), '600');
  });

  it('treats an OPTIONS without Access-Control-Request-Method as a normal request', () => {
    const e = event('OPTIONS', { origin: 'https://a.com' });
    const result = cors({ origin: 'https://a.com' })(e);
    strictEqual(result, undefined);
    strictEqual(e.response.status, 200);
    strictEqual(e.response.headers.get('access-control-allow-methods'), null);
  });
});
