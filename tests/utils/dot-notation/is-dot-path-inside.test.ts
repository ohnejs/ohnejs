import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isDotPathInside } from '../../../src/utils/index.ts';

describe('isDotPathInside', () => {
  it('accepts the parent itself', () => {
    strictEqual(isDotPathInside('items', 'items'), true);
  });

  it('accepts a path beneath a key or an index segment', () => {
    strictEqual(isDotPathInside('items.slug', 'items'), true);
    strictEqual(isDotPathInside('items[0].slug', 'items'), true);
    strictEqual(isDotPathInside('items[0].slug', 'items[0]'), true);
  });

  it('rejects a longer sibling name', () => {
    strictEqual(isDotPathInside('itemsCount', 'items'), false);
    strictEqual(isDotPathInside('items[10]', 'items[1]'), false);
  });

  it('rejects an ancestor', () => {
    strictEqual(isDotPathInside('items', 'items[0]'), false);
  });
});
