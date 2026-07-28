import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { capabilityCovers } from '../../../src/utils/index.ts';

describe('capabilityCovers', () => {
  it('covers an exact match', () => {
    strictEqual(capabilityCovers('collection.Posts.read', 'collection.Posts.read'), true);
  });

  it('covers everything with `*`', () => {
    strictEqual(capabilityCovers('*', 'collection.Posts.read'), true);
    strictEqual(capabilityCovers('*', 'billing.export'), true);
    strictEqual(capabilityCovers('*', '*'), true);
  });

  it('covers under a `.*` suffix', () => {
    strictEqual(capabilityCovers('collection.Posts.*', 'collection.Posts.read'), true);
    strictEqual(capabilityCovers('collection.*', 'collection.Posts.read'), true);
    strictEqual(capabilityCovers('collection.*', 'collection.Posts.*'), true);
  });

  it('does not cover across a segment boundary', () => {
    strictEqual(capabilityCovers('collection.Posts.*', 'collection.PostsDraft.read'), false);
  });

  it('does not cover a different capability', () => {
    strictEqual(capabilityCovers('collection.Posts.read', 'collection.Posts.update'), false);
    strictEqual(capabilityCovers('collection.Posts.read', 'collection.Users.read'), false);
  });

  it('never expands the required side', () => {
    strictEqual(capabilityCovers('collection.Posts.read', 'collection.Posts.*'), false);
    strictEqual(capabilityCovers('collection.Posts.read', '*'), false);
  });

  it('treats a bare prefix without `.*` as literal', () => {
    strictEqual(capabilityCovers('collection', 'collection.Posts.read'), false);
    strictEqual(capabilityCovers('collection.Posts', 'collection.Posts.read'), false);
  });
});
