import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { routeGlobMatcher } from '../../../src/ohne/routes/route-glob.ts';

describe('routeGlobMatcher', () => {
  it('matches a glob with no method prefix under any method', () => {
    const matches = routeGlobMatcher(['/users/**']);
    strictEqual(matches('GET', '/users/[id]'), true);
    strictEqual(matches(null, '/users/[id]/posts'), true);
    strictEqual(matches('GET', '/users'), false);
  });

  it('limits a prefixed glob to its method, in any case', () => {
    const matches = routeGlobMatcher(['post /users/[id]']);
    strictEqual(matches('POST', '/users/[id]'), true);
    strictEqual(matches('GET', '/users/[id]'), false);
    strictEqual(matches(null, '/users/[id]'), false);
  });

  it('keeps `*` within one segment and `[param]` literal', () => {
    const matches = routeGlobMatcher(['PATCH /collections/*/[uuid]']);
    strictEqual(matches('PATCH', '/collections/[collection]/[uuid]'), true);
    strictEqual(matches('PATCH', '/collections/[collection]/42'), false);
    strictEqual(matches('PATCH', '/collections/a/b/[uuid]'), false);
  });

  it('matches when any glob does, and never for none', () => {
    const matches = routeGlobMatcher(['/a', 'DELETE /b']);
    strictEqual(matches('GET', '/a'), true);
    strictEqual(matches('DELETE', '/b'), true);
    strictEqual(matches('GET', '/b'), false);
    strictEqual(routeGlobMatcher([])('GET', '/a'), false);
  });
});
