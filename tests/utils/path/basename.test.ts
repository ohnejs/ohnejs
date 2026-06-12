import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { basename } from '../../../src/utils/index.ts';

describe('basename', () => {
  it('returns an empty string for an empty input', () => {
    strictEqual(basename(''), '');
  });

  it('returns the only segment of a bare name', () => {
    strictEqual(basename('foo'), 'foo');
  });

  it('returns the last segment of a relative path', () => {
    strictEqual(basename('foo/bar'), 'bar');
  });

  it('returns the last segment of an absolute path', () => {
    strictEqual(basename('/foo/bar.txt'), 'bar.txt');
  });

  it('strips an extension when one is provided', () => {
    strictEqual(basename('/foo/bar.txt', '.txt'), 'bar');
  });

  it('keeps the segment when it equals the extension', () => {
    strictEqual(basename('.hidden', '.hidden'), '.hidden');
  });

  it('ignores a trailing slash', () => {
    strictEqual(basename('/foo/bar/'), 'bar');
  });

  it('returns an empty string for the POSIX root', () => {
    strictEqual(basename('/'), '');
  });

  it('returns the last segment under a drive root', () => {
    strictEqual(basename('C:/foo'), 'foo');
  });

  it('returns an empty string for the drive root', () => {
    strictEqual(basename('C:/'), '');
  });

  it('returns the last segment under a UNC share', () => {
    strictEqual(basename('//srv/sh/foo'), 'foo');
  });

  it('returns an empty string for the UNC share itself', () => {
    strictEqual(basename('//srv/sh'), '');
  });

  it('treats backslashes as separators', () => {
    strictEqual(basename('\\foo\\bar'), 'bar');
  });
});
