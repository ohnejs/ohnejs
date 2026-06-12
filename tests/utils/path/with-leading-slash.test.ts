import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { withLeadingSlash } from '../../../src/utils/index.ts';

describe('withLeadingSlash', () => {
  it('adds a leading slash to a bare path', () => {
    strictEqual(withLeadingSlash('foo'), '/foo');
  });

  it('leaves a path that already starts with a slash', () => {
    strictEqual(withLeadingSlash('/foo'), '/foo');
  });

  it('collapses repeated leading slashes to one', () => {
    strictEqual(withLeadingSlash('//foo'), '/foo');
    strictEqual(withLeadingSlash('///foo'), '/foo');
  });

  it('collapses repeated slashes anywhere in the path', () => {
    strictEqual(withLeadingSlash('foo//bar'), '/foo/bar');
  });

  it('returns a single slash for an empty input', () => {
    strictEqual(withLeadingSlash(''), '/');
  });
});
