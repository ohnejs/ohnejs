import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseRouteID } from '../../../src/utils/index.ts';

describe('parseRouteID', () => {
  it('splits a method-bound id into method and path', () => {
    deepStrictEqual(parseRouteID('GET /users/[id]'), { method: 'GET', path: '/users/[id]' });
    deepStrictEqual(parseRouteID('DELETE /users/1'), { method: 'DELETE', path: '/users/1' });
  });

  it('returns a bare path with no method', () => {
    deepStrictEqual(parseRouteID('/messages/[group]/[language]'), {
      path: '/messages/[group]/[language]',
    });
  });

  it('keeps a query string on the path', () => {
    deepStrictEqual(parseRouteID('GET /search?q=a b'), { method: 'GET', path: '/search?q=a b' });
  });

  it('returns a slashless id whole, never truncated', () => {
    deepStrictEqual(parseRouteID('search'), { path: 'search' });
    deepStrictEqual(parseRouteID('a b'), { path: 'a b' });
  });
});
