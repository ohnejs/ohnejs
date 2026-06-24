import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { HTTPMethod } from '../../../src/utils/index.ts';

import { createRouter, type Route } from '../../../src/ohne/index.ts';

function route(method: HTTPMethod | null, pattern: string): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'test', handler: () => null };
}

describe('createRouter', () => {
  it('matches a route and captures params', () => {
    const router = createRouter([route('GET', '/users/[id]')]);
    const result = router.match('GET', '/users/42');
    deepStrictEqual(result.type, 'matched');
    if (result.type === 'matched') {
      deepStrictEqual(result.route.pattern, '/users/[id]');
      deepStrictEqual(result.params, { id: '42' });
    }
  });

  it('captures a param followed by a static segment', () => {
    const router = createRouter([route('GET', '/[collection]/query')]);
    const result = router.match('GET', '/posts/query');
    deepStrictEqual(result.type === 'matched' && result.params, { collection: 'posts' });
    deepStrictEqual(router.match('GET', '/posts/other').type, 'not-found');
  });

  it('captures multiple params from one pattern', () => {
    const router = createRouter([route('GET', '/[collection]/[id]')]);
    const result = router.match('GET', '/posts/42');
    deepStrictEqual(result.type === 'matched' && result.params, { collection: 'posts', id: '42' });
    deepStrictEqual(router.match('GET', '/posts').type, 'not-found');
  });

  it('URI-decodes captured params', () => {
    const router = createRouter([route('GET', '/users/[name]')]);
    const result = router.match('GET', '/users/john%20doe');
    deepStrictEqual(result.type === 'matched' && result.params, { name: 'john doe' });
  });

  it('decodes a percent-encoded catch-all, keeping its slashes', () => {
    const router = createRouter([route('GET', '/files/[...path]')]);
    const result = router.match('GET', '/files/a%20b/c%2Bd');
    deepStrictEqual(result.type === 'matched' && result.params, { path: 'a b/c+d' });
  });

  it('leaves a malformed percent-sequence as its raw substring', () => {
    const router = createRouter([route('GET', '/users/[name]')]);
    const result = router.match('GET', '/users/%E0%A4%A');
    deepStrictEqual(result.type === 'matched' && result.params, { name: '%E0%A4%A' });
  });

  it('prefers a static route over a dynamic one', () => {
    const router = createRouter([route('GET', '/users/[id]'), route('GET', '/users/me')]);
    const result = router.match('GET', '/users/me');
    deepStrictEqual(result.type === 'matched' && result.route.pattern, '/users/me');
  });

  it('prefers a static route over a catch-all, and falls back to the catch-all', () => {
    const router = createRouter([route('GET', '/files/[...path]'), route('GET', '/files/readme')]);

    const exact = router.match('GET', '/files/readme');
    deepStrictEqual(exact.type === 'matched' && exact.route.pattern, '/files/readme');

    const deep = router.match('GET', '/files/a/b/c');
    deepStrictEqual(deep.type === 'matched' && deep.params, { path: 'a/b/c' });
  });

  it('returns method-not-allowed with the allowed methods', () => {
    const router = createRouter([route('GET', '/x'), route('POST', '/x')]);
    deepStrictEqual(router.match('PUT', '/x'), {
      type: 'method-not-allowed',
      allow: ['GET', 'HEAD', 'POST'],
    });
  });

  it('serves HEAD from the GET route when no HEAD route exists', () => {
    const router = createRouter([route('GET', '/users/[id]')]);
    const result = router.match('HEAD', '/users/42');
    deepStrictEqual(result.type === 'matched' && result.route.method, 'GET');
    deepStrictEqual(result.type === 'matched' && result.params, { id: '42' });
  });

  it('prefers an explicit HEAD route over the GET fallback', () => {
    const router = createRouter([route('GET', '/x'), route('HEAD', '/x')]);
    const result = router.match('HEAD', '/x');
    deepStrictEqual(result.type === 'matched' && result.route.method, 'HEAD');
  });

  it('does not invent HEAD for a path with no GET route', () => {
    const router = createRouter([route('POST', '/x')]);
    deepStrictEqual(router.match('HEAD', '/x'), { type: 'method-not-allowed', allow: ['POST'] });
  });

  it('returns not-found when no pattern matches', () => {
    const router = createRouter([route('GET', '/users/[id]')]);
    deepStrictEqual(router.match('GET', '/nope'), { type: 'not-found' });
  });

  it('a method-agnostic route answers any method', () => {
    const router = createRouter([route(null, '/any')]);
    deepStrictEqual(router.match('DELETE', '/any').type, 'matched');
    deepStrictEqual(router.match('PATCH', '/any').type, 'matched');
  });

  it('serves the method-correct route even when a more specific path matches another method', () => {
    const router = createRouter([route('GET', '/users/[id]'), route('POST', '/users/me')]);
    const result = router.match('GET', '/users/me');
    deepStrictEqual(result.type === 'matched' && result.route.pattern, '/users/[id]');
    deepStrictEqual(result.type === 'matched' && result.params, { id: 'me' });
  });
});
