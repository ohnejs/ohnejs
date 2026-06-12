import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { withoutLeadingSlash } from '../../../src/utils/index.ts';

describe('withoutLeadingSlash', () => {
  it('strips a leading slash', () => {
    strictEqual(withoutLeadingSlash('/foo'), 'foo');
  });

  it('leaves a path with no leading slash', () => {
    strictEqual(withoutLeadingSlash('foo'), 'foo');
  });

  it('strips repeated leading slashes', () => {
    strictEqual(withoutLeadingSlash('//foo'), 'foo');
    strictEqual(withoutLeadingSlash('///foo'), 'foo');
  });

  it('collapses repeated slashes anywhere in the path', () => {
    strictEqual(withoutLeadingSlash('foo//bar'), 'foo/bar');
  });

  it('returns an empty string for `/`', () => {
    strictEqual(withoutLeadingSlash('/'), '');
  });

  it('returns an empty string for an empty input', () => {
    strictEqual(withoutLeadingSlash(''), '');
  });
});
