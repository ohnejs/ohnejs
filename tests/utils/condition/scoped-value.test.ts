import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { scopedValue } from '../../../src/utils/index.ts';

describe('scopedValue', () => {
  const scopes = [{ title: 'Guide', seo: { title: 'SEO' } }, { label: 'Step 1' }];

  it('reads the innermost scope for a bare path', () => {
    strictEqual(scopedValue(scopes, ['label']), 'Step 1');
  });

  it('climbs with `..` and jumps to the root with `/`', () => {
    strictEqual(scopedValue(scopes, ['..', 'title']), 'Guide');
    strictEqual(scopedValue(scopes, ['/', 'seo', 'title']), 'SEO');
  });

  it('reads `undefined` without scopes or past the root', () => {
    strictEqual(scopedValue([], ['title']), undefined);
    strictEqual(scopedValue(scopes, ['..', '..', 'title']), undefined);
  });
});
