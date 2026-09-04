import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  handleUnauthorized,
  isSessionExpiry,
  requestTarget,
  setUnauthorizedHandler,
} from '../../../src/dashboard/runtime/_request.ts';

describe('requestTarget', () => {
  it('parses the method off the id and appends the path to the base URL', () => {
    deepStrictEqual(requestTarget('http://localhost:3000', 'GET /authors'), {
      method: 'GET',
      path: '/authors',
      url: 'http://localhost:3000/authors',
    });
  });

  it('leaves a bare path without a method', () => {
    deepStrictEqual(requestTarget('https://api.example.com', '/health'), {
      path: '/health',
      url: 'https://api.example.com/health',
    });
  });

  it('keeps the query string on the path', () => {
    const target = requestTarget('http://localhost:3000', 'POST /uploads?name=a%20b');
    strictEqual(target.method, 'POST');
    strictEqual(target.path, '/uploads?name=a%20b');
    strictEqual(target.url, 'http://localhost:3000/uploads?name=a%20b');
  });
});

describe('isSessionExpiry', () => {
  it('is a 401 from a route outside /auth/', () => {
    strictEqual(isSessionExpiry(401, '/collections/posts'), true);
    strictEqual(isSessionExpiry(401, '/dashboard'), true);
  });

  it('is never a 401 from an auth route', () => {
    strictEqual(isSessionExpiry(401, '/auth/me'), false);
    strictEqual(isSessionExpiry(401, '/auth/login'), false);
  });

  it('is never another status', () => {
    strictEqual(isSessionExpiry(403, '/collections/posts'), false);
    strictEqual(isSessionExpiry(200, '/collections/posts'), false);
  });
});

describe('handleUnauthorized', () => {
  it('calls the installed handler for a session expiry alone', () => {
    let calls = 0;
    setUnauthorizedHandler(() => {
      calls += 1;
    });
    handleUnauthorized(200, '/collections/posts');
    handleUnauthorized(401, '/auth/me');
    strictEqual(calls, 0);
    handleUnauthorized(401, '/collections/posts');
    strictEqual(calls, 1);
    setUnauthorizedHandler(null);
    handleUnauthorized(401, '/collections/posts');
    strictEqual(calls, 1);
  });
});
