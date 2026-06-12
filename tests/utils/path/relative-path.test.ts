import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { relativePath } from '../../../src/utils/index.ts';

describe('relativePath', () => {
  it('returns an empty string for identical paths', () => {
    strictEqual(relativePath('/a/b', '/a/b'), '');
  });

  it('walks down into a deeper path', () => {
    strictEqual(relativePath('/a/b', '/a/b/c'), 'c');
  });

  it('walks up and across', () => {
    strictEqual(relativePath('/a/b/c', '/a/b/d'), '../d');
  });

  it('walks up to the common ancestor', () => {
    strictEqual(relativePath('/a/b/c', '/a/b'), '..');
  });

  it('works on relative inputs', () => {
    strictEqual(relativePath('a/b', 'a/c'), '../c');
    strictEqual(relativePath('a/b', 'c/d'), '../../c/d');
  });

  it('returns the destination when mixing absolute and relative', () => {
    strictEqual(relativePath('/a', 'b/c'), 'b/c');
  });

  it('returns the destination for different Windows drives', () => {
    strictEqual(relativePath('C:/a/b', 'D:/x'), 'D:/x');
  });

  it('walks within the same Windows drive', () => {
    strictEqual(relativePath('C:/a/b', 'C:/a/c'), '../c');
  });

  it('walks within the same UNC share', () => {
    strictEqual(relativePath('//srv/sh/a', '//srv/sh/b'), '../b');
  });

  it('returns the destination for different UNC shares', () => {
    strictEqual(relativePath('//srv/sh1/a', '//srv/sh2/a'), '//srv/sh2/a');
  });

  it('treats `.` as the current directory', () => {
    strictEqual(relativePath('.', 'foo'), 'foo');
    strictEqual(relativePath('foo', '.'), '..');
  });

  it('handles a `from` that normalizes to `.`', () => {
    strictEqual(relativePath('foo/..', 'bar'), 'bar');
  });
});
