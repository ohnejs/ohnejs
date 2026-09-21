import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  currentSession,
  endSession,
  handleUnauthorized,
  isSessionExpiry,
  requestTarget,
  setUnauthorizedHandler,
  startSession,
  withAcceptLanguage,
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
  let calls = 0;

  beforeEach(() => {
    calls = 0;
    setUnauthorizedHandler(() => {
      calls += 1;
    });
  });

  afterEach(() => setUnauthorizedHandler(null));

  it('calls the installed handler for a session expiry alone', () => {
    startSession();
    const sentUnder = currentSession();
    handleUnauthorized(200, '/collections/posts', sentUnder);
    handleUnauthorized(401, '/auth/me', sentUnder);
    strictEqual(calls, 0);
    handleUnauthorized(401, '/collections/posts', sentUnder);
    strictEqual(calls, 1);
    setUnauthorizedHandler(null);
    handleUnauthorized(401, '/collections/posts', sentUnder);
    strictEqual(calls, 1);
  });

  it('drops a 401 for a request sent while signed out', () => {
    endSession();
    const sentUnder = currentSession();
    startSession();
    handleUnauthorized(401, '/collections/posts', sentUnder);
    strictEqual(calls, 0);
  });

  it('drops a 401 that answers after a sign-out began', () => {
    startSession();
    const sentUnder = currentSession();
    endSession();
    handleUnauthorized(401, '/collections/posts', sentUnder);
    strictEqual(calls, 0);
  });

  it('drops a 401 for a request from a session a sign-in replaced', () => {
    startSession();
    const sentUnder = currentSession();
    startSession();
    handleUnauthorized(401, '/collections/posts', sentUnder);
    strictEqual(calls, 0);
  });
});

describe('withAcceptLanguage', () => {
  it('sets the language on a record', () => {
    const headers = withAcceptLanguage({ 'content-type': 'application/json' }, 'de');
    strictEqual(headers.get('accept-language'), 'de');
    strictEqual(headers.get('content-type'), 'application/json');
  });

  it('sets the language on a tuple list', () => {
    const headers = withAcceptLanguage([['content-type', 'application/json']], 'de');
    strictEqual(headers.get('accept-language'), 'de');
    strictEqual(headers.get('content-type'), 'application/json');
  });

  it('sets the language on a fresh copy of a Headers instance', () => {
    const given = new Headers({ 'content-type': 'application/json' });
    const headers = withAcceptLanguage(given, 'de');
    strictEqual(headers.get('accept-language'), 'de');
    strictEqual(headers.get('content-type'), 'application/json');
    strictEqual(given.has('accept-language'), false);
  });

  it('sets the language when no headers are given', () => {
    strictEqual(withAcceptLanguage(undefined, 'de').get('accept-language'), 'de');
  });

  it('keeps a language the caller set, in any letter case', () => {
    strictEqual(withAcceptLanguage({ 'Accept-Language': 'en' }, 'de').get('accept-language'), 'en');
    strictEqual(withAcceptLanguage([['ACCEPT-LANGUAGE', 'bs']], 'de').get('accept-language'), 'bs');
    const given = new Headers({ 'accept-language': 'en-GB' });
    strictEqual(withAcceptLanguage(given, 'de').get('accept-language'), 'en-GB');
  });
});
