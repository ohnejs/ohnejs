import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isKebabCase, slugifyPath } from '../../../src/utils/index.ts';

describe('slugifyPath', () => {
  it('slugifies each segment and drops the empty ones', () => {
    strictEqual(slugifyPath('Docs / Getting Started'), 'docs/getting-started');
    strictEqual(slugifyPath('/a//B/'), 'a/b');
    strictEqual(slugifyPath('Привет/Thrall'), 'thrall');
  });

  it('gives an empty path for input with no Latin letter or digit', () => {
    strictEqual(slugifyPath('Привет'), '');
    strictEqual(slugifyPath('/'), '');
  });

  it('is idempotent, and every segment is kebab case', () => {
    for (const input of ['Über uns/AC DC', 'a//b', '½ / ß straße', 'x']) {
      const once = slugifyPath(input);
      strictEqual(slugifyPath(once), once);
      for (const segment of once.split('/')) strictEqual(isKebabCase(segment), true, segment);
    }
  });
});
