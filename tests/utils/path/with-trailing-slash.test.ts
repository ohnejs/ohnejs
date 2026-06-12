import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { withTrailingSlash } from '../../../src/utils/index.ts';

describe('withTrailingSlash', () => {
  it('adds a trailing slash to a bare path', () => {
    strictEqual(withTrailingSlash('foo'), 'foo/');
  });

  it('leaves a path that already ends with a slash', () => {
    strictEqual(withTrailingSlash('foo/'), 'foo/');
  });

  it('collapses repeated trailing slashes to one', () => {
    strictEqual(withTrailingSlash('foo//'), 'foo/');
    strictEqual(withTrailingSlash('foo///'), 'foo/');
  });

  it('collapses repeated slashes anywhere in the path', () => {
    strictEqual(withTrailingSlash('foo//bar'), 'foo/bar/');
  });

  it('returns a single slash for an empty input', () => {
    strictEqual(withTrailingSlash(''), '/');
  });
});
