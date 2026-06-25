import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { cacheControl } from '../../../src/utils/index.ts';

describe('cacheControl', () => {
  it('builds a single boolean directive', () => {
    strictEqual(cacheControl({ noStore: true }), 'no-store');
  });

  it('combines visibility and max-age', () => {
    strictEqual(cacheControl({ public: true, maxAge: 3600 }), 'public, max-age=3600');
  });

  it('floors fractional seconds', () => {
    strictEqual(cacheControl({ maxAge: 59.9 }), 'max-age=59');
  });

  it('emits max-age=0 but omits unset fields', () => {
    strictEqual(cacheControl({ maxAge: 0 }), 'max-age=0');
  });

  it('returns an empty string for no directives', () => {
    strictEqual(cacheControl({}), '');
  });

  it('orders directives consistently regardless of key order', () => {
    strictEqual(
      cacheControl({ immutable: true, maxAge: 100, public: true }),
      'public, max-age=100, immutable',
    );
  });

  it('includes s-maxage and stale-while-revalidate', () => {
    strictEqual(
      cacheControl({ sMaxAge: 60, staleWhileRevalidate: 30 }),
      's-maxage=60, stale-while-revalidate=30',
    );
  });
});
