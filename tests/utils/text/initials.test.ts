import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { initials } from '../../../src/utils/index.ts';

describe('initials', () => {
  it('takes the first and last words', () => {
    strictEqual(initials('Jaina Lady Proudmoore'), 'JP');
  });

  it('gives one letter for one word', () => {
    strictEqual(initials('Thrall'), 'T');
  });

  it('uppercases and ignores surrounding space', () => {
    strictEqual(initials('  anduin   wrynn '), 'AW');
  });

  it('gives nothing for blank text', () => {
    strictEqual(initials(' \t '), '');
  });

  it('keeps a letter outside the Basic Multilingual Plane whole', () => {
    strictEqual(initials('𝒜zshara'), '𝒜');
  });
});
