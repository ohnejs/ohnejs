import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { withoutTrailingSlash } from '../../../src/utils/index.ts';

describe('withoutTrailingSlash', () => {
  it('strips a trailing slash', () => {
    strictEqual(withoutTrailingSlash('foo/'), 'foo');
  });

  it('leaves a path with no trailing slash', () => {
    strictEqual(withoutTrailingSlash('foo'), 'foo');
  });

  it('strips repeated trailing slashes', () => {
    strictEqual(withoutTrailingSlash('foo//'), 'foo');
    strictEqual(withoutTrailingSlash('foo///'), 'foo');
  });

  it('collapses repeated slashes anywhere in the path', () => {
    strictEqual(withoutTrailingSlash('foo//bar'), 'foo/bar');
  });

  it('returns an empty string for `/`', () => {
    strictEqual(withoutTrailingSlash('/'), '');
  });

  it('returns an empty string for an empty input', () => {
    strictEqual(withoutTrailingSlash(''), '');
  });
});
