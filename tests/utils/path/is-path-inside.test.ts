import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPathInside } from '../../../src/utils/index.ts';

describe('isPathInside', () => {
  it('accepts a nested path', () => {
    strictEqual(isPathInside('/a/b/c.ts', '/a/b'), true);
    strictEqual(isPathInside('/a/b/c/d.ts', '/a/b'), true);
  });

  it('accepts the directory itself', () => {
    strictEqual(isPathInside('/a/b', '/a/b'), true);
  });

  it('accepts a child whose name starts with dots', () => {
    strictEqual(isPathInside('/a/b/..x.ts', '/a/b'), true);
    strictEqual(isPathInside('/a/b/...rc', '/a/b'), true);
  });

  it('rejects a sibling path', () => {
    strictEqual(isPathInside('/a/c.ts', '/a/b'), false);
  });

  it('rejects an ancestor', () => {
    strictEqual(isPathInside('/a', '/a/b'), false);
  });

  it('rejects a prefix that is not a path boundary', () => {
    strictEqual(isPathInside('/a/bc/d.ts', '/a/b'), false);
  });

  it('normalizes both inputs', () => {
    strictEqual(isPathInside('/a/b/../b/c.ts', '/a//b'), true);
    strictEqual(isPathInside('/a\\b\\c.ts', '/a/b'), true);
  });

  it('rejects paths on different roots', () => {
    strictEqual(isPathInside('D:/x/y', 'C:/x'), false);
  });
});
