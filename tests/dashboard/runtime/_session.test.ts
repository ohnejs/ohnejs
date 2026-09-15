import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { loginRefusal } from '../../../src/dashboard/runtime/_session.ts';

describe('loginRefusal', () => {
  it('is invalid for the 401 a wrong email or password answers', () => {
    deepStrictEqual(loginRefusal(401), { kind: 'invalid' });
  });

  it('fails with the status for any other refusal', () => {
    deepStrictEqual(loginRefusal(400), { kind: 'failed', status: 400 });
    deepStrictEqual(loginRefusal(429), { kind: 'failed', status: 429 });
    deepStrictEqual(loginRefusal(500), { kind: 'failed', status: 500 });
  });
});
