import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { extname } from '../../../src/utils/index.ts';

describe('extname', () => {
  it('returns an empty string for an empty input', () => {
    strictEqual(extname(''), '');
  });

  it('returns the extension of a bare name', () => {
    strictEqual(extname('foo.txt'), '.txt');
  });

  it('returns the extension of a nested path', () => {
    strictEqual(extname('/a/b/foo.txt'), '.txt');
  });

  it('returns only the last extension', () => {
    strictEqual(extname('archive.tar.gz'), '.gz');
  });

  it('returns an empty string for a dotfile', () => {
    strictEqual(extname('.hidden'), '');
  });

  it('returns an empty string for a name with no extension', () => {
    strictEqual(extname('foo'), '');
  });

  it('returns a bare dot for a trailing dot', () => {
    strictEqual(extname('foo.'), '.');
  });

  it('returns an empty string when only directory has a dot', () => {
    strictEqual(extname('a.b/foo'), '');
  });

  it('treats backslashes as separators', () => {
    strictEqual(extname('a\\b\\foo.txt'), '.txt');
  });

  it('returns an empty string when the segment is exactly ".."', () => {
    strictEqual(extname('..'), '');
    strictEqual(extname('a/..'), '');
    strictEqual(extname('/foo/..'), '');
  });
});
