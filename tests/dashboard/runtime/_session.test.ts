import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { loginRefusal } from '../../../src/dashboard/runtime/_session.ts';

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('loginRefusal', () => {
  it('is invalid for the 401 a wrong email or password answers', () => {
    deepStrictEqual(loginRefusal(answer(401)), { kind: 'invalid' });
  });

  it('is throttled for a 429, reading its Retry-After seconds', () => {
    deepStrictEqual(loginRefusal(answer(429, { 'Retry-After': '30' })), {
      kind: 'throttled',
      retryAfter: 30,
    });
  });

  it('is throttled for a 503, waiting 0 seconds when no Retry-After is named', () => {
    deepStrictEqual(loginRefusal(answer(503)), { kind: 'throttled', retryAfter: 0 });
  });

  it('fails with the status for any other refusal', () => {
    deepStrictEqual(loginRefusal(answer(400)), { kind: 'failed', status: 400 });
    deepStrictEqual(loginRefusal(answer(500)), { kind: 'failed', status: 500 });
  });
});
