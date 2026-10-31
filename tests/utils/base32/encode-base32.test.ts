import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { encodeBase32 } from '../../../src/utils/index.ts';

const encode = (text: string) => encodeBase32(new TextEncoder().encode(text));

describe('encodeBase32', () => {
  it('matches the RFC 4648 vectors, unpadded', () => {
    strictEqual(encode(''), '');
    strictEqual(encode('f'), 'MY');
    strictEqual(encode('fo'), 'MZXQ');
    strictEqual(encode('foo'), 'MZXW6');
    strictEqual(encode('foob'), 'MZXW6YQ');
    strictEqual(encode('fooba'), 'MZXW6YTB');
    strictEqual(encode('foobar'), 'MZXW6YTBOI');
  });

  it('encodes every byte value', () => {
    strictEqual(encodeBase32(new Uint8Array([0, 0, 0, 0, 0])), 'AAAAAAAA');
    strictEqual(encodeBase32(new Uint8Array([255, 255, 255, 255, 255])), '77777777');
  });
});
