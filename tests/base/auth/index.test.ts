import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import * as auth from '../../../src/base/auth/index.ts';
import { readScope } from '../../../src/base/collections-api/gate.ts';

describe('ohnejs/auth', () => {
  it('exports `readScope`, so a route of your own asks the read verdict', () => {
    strictEqual(auth.readScope, readScope);
  });
});
