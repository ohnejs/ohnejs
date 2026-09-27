import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, matchPath, matchesPath, runWithEvent } from '../../../src/ohne/index.ts';

function eventFor(pathname: string): Event {
  const url = new URL(`http://localhost${pathname}`);
  return {
    request: new Request(url),
    url,
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('matchPath', () => {
  it('matches a glob against the request path', () => {
    runWithEvent(eventFor('/admin/users'), () => {
      strictEqual(matchPath('/admin/**'), true);
      strictEqual(matchPath('/public/**'), false);
    });
  });

  it('matches a route pattern against the request path', () => {
    runWithEvent(eventFor('/users/42'), () => {
      strictEqual(matchPath('/users/[id]'), true);
      strictEqual(matchPath('/users/[id]/edit'), false);
    });
  });

  it('returns true when any candidate matches', () => {
    runWithEvent(eventFor('/admin/users'), () => {
      strictEqual(matchPath('/public/**', '/admin/[section]'), true);
      strictEqual(matchPath('/public/**', '/static/*'), false);
    });
  });
});

describe('matchesPath', () => {
  it('matches an explicit path against globs and route patterns', () => {
    strictEqual(matchesPath('/admin/users', '/admin/**'), true);
    strictEqual(matchesPath('/admin/users', '/admin/[section]'), true);
    strictEqual(matchesPath('/admin/users', '/public/**'), false);
  });

  it('matches a glob against the path as a route matches it', () => {
    strictEqual(matchesPath('/admin/users/', '/admin/users'), true);
    strictEqual(matchesPath('/admin/', '/admin'), true);
    strictEqual(matchesPath('/admin/', '/admin/**'), true);
  });

  it('matches a glob against the raw, undecoded path', () => {
    strictEqual(matchesPath('/%70ublic/x', '/public/**'), false);
  });

  it('needs no bound request', () => {
    strictEqual(matchesPath('/users/42', '/users/[id]'), true);
  });
});
