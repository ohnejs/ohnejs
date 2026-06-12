import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathToRoutePattern } from '../../../src/utils/index.ts';

describe('pathToRoutePattern', () => {
  it('strips a leading ./ and the extension', () => {
    strictEqual(pathToRoutePattern('./foo/bar.ts'), '/foo/bar');
  });

  it('drops a trailing index segment', () => {
    strictEqual(pathToRoutePattern('./foo/index.ts'), '/foo');
    strictEqual(pathToRoutePattern('./index.ts'), '/');
  });

  it('preserves bracketed params', () => {
    strictEqual(pathToRoutePattern('./foo/[bar]/index.ts'), '/foo/[bar]');
    strictEqual(pathToRoutePattern('./[id]/posts.ts'), '/[id]/posts');
  });

  it('preserves catch-all params', () => {
    strictEqual(pathToRoutePattern('./files/[...path].ts'), '/files/[...path]');
  });

  it('preserves colon params', () => {
    strictEqual(pathToRoutePattern('./users/:id.ts'), '/users/:id');
  });

  it('accepts any file extension', () => {
    strictEqual(pathToRoutePattern('./foo/bar.tsx'), '/foo/bar');
    strictEqual(pathToRoutePattern('./foo/bar.vue'), '/foo/bar');
    strictEqual(pathToRoutePattern('./foo/bar'), '/foo/bar');
  });

  it('normalizes backslashes', () => {
    strictEqual(pathToRoutePattern('foo\\bar.ts'), '/foo/bar');
  });

  it('resolves "." and ".." segments', () => {
    strictEqual(pathToRoutePattern('./foo/../bar.ts'), '/bar');
    strictEqual(pathToRoutePattern('./foo/./bar.ts'), '/foo/bar');
  });

  it('reduces an empty or root input to /', () => {
    strictEqual(pathToRoutePattern(''), '/');
    strictEqual(pathToRoutePattern('.'), '/');
    strictEqual(pathToRoutePattern('/'), '/');
  });
});
