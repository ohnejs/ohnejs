import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { encodeCrockford, normalizeCrockford } from '../../../src/utils/index.ts';

const encode = (text: string) => encodeCrockford(new TextEncoder().encode(text));

describe('encodeCrockford', () => {
  it('matches the known vectors, unpadded', () => {
    strictEqual(encode(''), '');
    strictEqual(encode('f'), 'CR');
    strictEqual(encode('foobar'), 'CSQPYRK1E8');
  });

  it('encodes every byte value', () => {
    strictEqual(encodeCrockford(new Uint8Array([0, 0, 0, 0, 0])), '00000000');
    strictEqual(encodeCrockford(new Uint8Array([255, 255, 255, 255, 255])), 'ZZZZZZZZ');
  });

  it('never emits I, L, O or U', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    strictEqual(/[ILOU]/.test(encodeCrockford(bytes)), false);
  });

  it('round-trips through normalizeCrockford', () => {
    const code = encodeCrockford(Uint8Array.from([0x9d, 0xe8, 0x9d, 0xd4, 0x5d, 0xb7, 0xb0]));
    strictEqual(code, 'KQM9VN2XPYR0');
    strictEqual(normalizeCrockford(code.toLowerCase()), code);
  });
});
