import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { encodeBase64URL } from '../../../src/utils/index.ts';

describe('encodeBase64URL', () => {
  it('uses the URL alphabet without padding', () => {
    strictEqual(encodeBase64URL(new Uint8Array([251, 255])), '-_8');
    strictEqual(encodeBase64URL(new Uint8Array()), '');
  });
});
