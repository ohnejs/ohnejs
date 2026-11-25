import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isAuthenticationResponseJSON } from '../../../src/utils/index.ts';

const base = { id: 'abc', type: 'public-key' };

describe('isAuthenticationResponseJSON', () => {
  it('accepts the browser shape and refuses a partial one', () => {
    const response = { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' };
    strictEqual(isAuthenticationResponseJSON({ ...base, response }), true);
    strictEqual(isAuthenticationResponseJSON({ ...base, response: { signature: 'c' } }), false);
    strictEqual(isAuthenticationResponseJSON({ id: 'abc', response }), false);
  });
});
