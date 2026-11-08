import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { normalizeCrockford } from '../../../src/utils/index.ts';

describe('normalizeCrockford', () => {
  it('uppercases', () => {
    strictEqual(normalizeCrockford('k7m4xq2pzr'), 'K7M4XQ2PZR');
  });

  it('drops spaces, hyphens and dots', () => {
    strictEqual(normalizeCrockford('k7m4x-q2pzr'), 'K7M4XQ2PZR');
    strictEqual(normalizeCrockford(' K7M4X Q2PZR '), 'K7M4XQ2PZR');
    strictEqual(normalizeCrockford('K7M.4X-Q2 PZR'), 'K7M4XQ2PZR');
  });

  it('reads O as 0 and I and L as 1', () => {
    strictEqual(normalizeCrockford('OIL'), '011');
    strictEqual(normalizeCrockford('oil'), '011');
  });

  it('rejects U and anything else outside the alphabet', () => {
    strictEqual(normalizeCrockford('olu'), undefined);
    strictEqual(normalizeCrockford('K7M4X_Q2PZR'), undefined);
    strictEqual(normalizeCrockford('K7M4X/Q2PZR'), undefined);
    strictEqual(normalizeCrockford('K7M4XQ2PZRÄ'), undefined);
  });

  it('rejects non-ASCII letters that uppercase into the alphabet', () => {
    for (const text of ['ß', 'ı', 'ſ', 'ﬆ']) strictEqual(normalizeCrockford(text), undefined);
  });

  it('leaves the length unchecked', () => {
    strictEqual(normalizeCrockford(''), '');
    strictEqual(normalizeCrockford('-'), '');
    strictEqual(
      normalizeCrockford('0123456789ABCDEFGHJKMNPQRSTVWXYZ'),
      '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
    );
  });
});
