import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hasCapability } from '../../../src/utils/index.ts';

describe('hasCapability', () => {
  it('finds a covering entry anywhere in the set', () => {
    strictEqual(
      hasCapability(['billing.export', 'collection.Posts.*'], 'collection.Posts.read'),
      true,
    );
  });

  it('covers through the global wildcard', () => {
    strictEqual(hasCapability(['*'], 'anything.at.all'), true);
  });

  it('rejects when no entry covers', () => {
    strictEqual(hasCapability(['collection.Posts.read'], 'collection.Posts.update'), false);
  });

  it('rejects an empty set', () => {
    strictEqual(hasCapability([], 'collection.Posts.read'), false);
  });
});
