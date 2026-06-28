import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { normalizeBasePath } from '../../../src/utils/index.ts';

describe('normalizeBasePath', () => {
  it('collapses every slash variant to one form', () => {
    strictEqual(normalizeBasePath('/api'), '/api');
    strictEqual(normalizeBasePath('api/'), '/api');
    strictEqual(normalizeBasePath('/api/'), '/api');
    strictEqual(normalizeBasePath('api'), '/api');
  });

  it('keeps inner segments and strips only the edges', () => {
    strictEqual(normalizeBasePath('/v1/api'), '/v1/api');
    strictEqual(normalizeBasePath('v1/api/'), '/v1/api');
  });

  it('folds stray inner and edge double slashes', () => {
    strictEqual(normalizeBasePath('/api//v1'), '/api/v1');
    strictEqual(normalizeBasePath('//api//v1//'), '/api/v1');
  });

  it('yields no prefix for empty or slash-only input', () => {
    strictEqual(normalizeBasePath(''), '');
    strictEqual(normalizeBasePath('/'), '');
    strictEqual(normalizeBasePath('///'), '');
  });
});
