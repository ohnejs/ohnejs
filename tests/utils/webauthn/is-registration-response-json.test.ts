import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRegistrationResponseJSON } from '../../../src/utils/index.ts';

const base = { id: 'abc', type: 'public-key' };

describe('isRegistrationResponseJSON', () => {
  it('accepts the browser shape, with or without transports', () => {
    const response = { clientDataJSON: 'a', attestationObject: 'b' };
    strictEqual(isRegistrationResponseJSON({ ...base, response }), true);
    strictEqual(
      isRegistrationResponseJSON({ ...base, response: { ...response, transports: ['usb'] } }),
      true,
    );
  });

  it('refuses a missing field or a foreign transport list', () => {
    strictEqual(isRegistrationResponseJSON({ ...base, response: { clientDataJSON: 'a' } }), false);
    strictEqual(
      isRegistrationResponseJSON({
        ...base,
        response: { clientDataJSON: 'a', attestationObject: 'b', transports: [1] },
      }),
      false,
    );
    strictEqual(isRegistrationResponseJSON('abc'), false);
  });
});
