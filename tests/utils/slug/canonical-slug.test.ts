import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { canonicalSlug } from '../../../src/utils/index.ts';

describe('canonicalSlug', () => {
  it('folds `/` like any punctuation in a flat slug', () => {
    strictEqual(canonicalSlug('AC/DC'), 'ac-dc');
    strictEqual(canonicalSlug('Über uns'), 'uber-uns');
    strictEqual(canonicalSlug('AC/DC', { nested: false }), 'ac-dc');
  });

  it('keeps `/` between segments in a nested slug', () => {
    strictEqual(canonicalSlug('AC/DC', { nested: true }), 'ac/dc');
    strictEqual(canonicalSlug('/Docs//Install/', { nested: true }), 'docs/install');
  });
});
