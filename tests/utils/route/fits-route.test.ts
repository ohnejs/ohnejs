import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { fitsRoute } from '../../../src/utils/index.ts';

describe('fitsRoute', () => {
  it('takes a value that fills its param without changing the path shape', () => {
    strictEqual(fitsRoute('/blog/[slug]', { slug: 'hello' }), true);
    strictEqual(fitsRoute('/[...slug]', { slug: 'about/team' }), true);
    strictEqual(fitsRoute('/contact', {}), true);
  });

  it('refuses a slash in one segment, an empty or dot segment, and a missing param', () => {
    strictEqual(fitsRoute('/blog/[slug]', { slug: 'a/b' }), false);
    for (const slug of ['', '.', '..', 'a//b', 'a/', '/a', 'x/..']) {
      strictEqual(fitsRoute('/[...slug]', { slug }), false, slug);
    }
    strictEqual(fitsRoute('/blog/[slug]', {}), false);
  });
});
