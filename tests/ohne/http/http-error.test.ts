import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  badRequest,
  forbidden,
  HTTPError,
  notFound,
  notImplemented,
  tooManyRequests,
  unauthorized,
  unprocessable,
} from '../../../src/ohne/index.ts';

describe('HTTPError', () => {
  it('carries status, message, and data', () => {
    const error = new HTTPError(418, 'short and stout', { teapot: true });
    ok(error instanceof Error);
    strictEqual(error.name, 'HTTPError');
    strictEqual(error.status, 418);
    strictEqual(error.message, 'short and stout');
    deepStrictEqual(error.data, { teapot: true });
  });

  it('leaves data undefined when omitted', () => {
    strictEqual(new HTTPError(400, 'bad').data, undefined);
  });
});

describe('HTTPError constructors', () => {
  it('map to their status, the message defaulting to the catalog key', () => {
    strictEqual(badRequest().status, 400);
    strictEqual(badRequest().message, 'api.http.badRequest');
    strictEqual(unauthorized().status, 401);
    strictEqual(forbidden().status, 403);
    strictEqual(notFound().status, 404);
    strictEqual(unprocessable().status, 422);
    strictEqual(unprocessable().message, 'api.http.unprocessableContent');
    strictEqual(tooManyRequests().status, 429);
  });

  it('`notImplemented` maps to `501`, the message defaulting to the catalog key', () => {
    const error = notImplemented(undefined, { storage: 'ledger' });
    strictEqual(error.status, 501);
    strictEqual(error.message, 'api.http.notImplemented');
    deepStrictEqual(error.data, { storage: 'ledger' });
  });

  it('take a custom message and data', () => {
    const error = unprocessable('Password too short', { field: 'password' });
    strictEqual(error.message, 'Password too short');
    deepStrictEqual(error.data, { field: 'password' });
  });
});
