import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeBase64URL, encodeBase64URL } from '../../../src/utils/index.ts';

describe('decodeBase64URL', () => {
  it('decodes padded and unpadded text', () => {
    deepStrictEqual(decodeBase64URL('-_8'), new Uint8Array([251, 255]));
    deepStrictEqual(decodeBase64URL('-_8='), new Uint8Array([251, 255]));
  });

  it('round-trips encodeBase64URL', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    deepStrictEqual(decodeBase64URL(encodeBase64URL(bytes)), bytes);
  });
});
