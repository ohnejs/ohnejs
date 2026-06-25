import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { vary } from '../../../src/utils/index.ts';

describe('vary', () => {
  it('adds a field to an empty header', () => {
    strictEqual(vary('', 'Accept'), 'Accept');
  });

  it('appends to an existing header', () => {
    strictEqual(vary('Accept-Encoding', 'Accept'), 'Accept-Encoding, Accept');
  });

  it('dedups case-insensitively, keeping the first casing', () => {
    strictEqual(vary('Accept', 'accept'), 'Accept');
  });

  it('collapses to * when any field is *', () => {
    strictEqual(vary('Accept', '*'), '*');
  });

  it('splits comma-separated tokens', () => {
    strictEqual(
      vary('Accept, Accept-Encoding', 'Accept-Language'),
      'Accept, Accept-Encoding, Accept-Language',
    );
  });

  it('drops blank tokens', () => {
    strictEqual(vary('Accept, , ', 'Accept-Encoding'), 'Accept, Accept-Encoding');
  });

  it('appends multiple fields', () => {
    strictEqual(vary('', 'Accept', 'Accept-Language'), 'Accept, Accept-Language');
  });
});
