import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isEnvName } from '../../../src/utils/env/is-env-name.ts';

describe('isEnvName', () => {
  it('accepts a name a `.env` file can set', () => {
    for (const value of ['ANTHROPIC_API_KEY', '_PRIVATE', 'key2', 'a']) {
      strictEqual(isEnvName(value), true, value);
    }
  });

  it('refuses anything else', () => {
    for (const value of ['2FA_SECRET', 'api-key', 'API KEY', 'KEY\n', '', 42, false]) {
      strictEqual(isEnvName(value), false, String(value));
    }
  });
});
