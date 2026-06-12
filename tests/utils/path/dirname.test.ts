import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dirname } from '../../../src/utils/index.ts';

describe('dirname', () => {
  it('returns `.` for an empty string', () => {
    strictEqual(dirname(''), '.');
  });

  it('returns `.` for a single segment', () => {
    strictEqual(dirname('foo'), '.');
  });

  it('returns the parent of a nested relative path', () => {
    strictEqual(dirname('foo/bar'), 'foo');
  });

  it('ignores a trailing slash', () => {
    strictEqual(dirname('foo/bar/'), 'foo');
  });

  it('returns the POSIX root for a top-level absolute path', () => {
    strictEqual(dirname('/foo'), '/');
  });

  it('returns the POSIX root itself for `/`', () => {
    strictEqual(dirname('/'), '/');
  });

  it('returns the parent of a nested absolute path', () => {
    strictEqual(dirname('/foo/bar'), '/foo');
  });

  it('returns the drive root for a top-level drive path', () => {
    strictEqual(dirname('C:/foo'), 'C:/');
  });

  it('returns the parent of a nested drive path', () => {
    strictEqual(dirname('C:/foo/bar'), 'C:/foo');
  });

  it('returns the UNC share for a top-level UNC path', () => {
    strictEqual(dirname('//srv/sh/foo'), '//srv/sh');
  });

  it('returns the UNC share for the share itself', () => {
    strictEqual(dirname('//srv/sh'), '//srv/sh');
  });

  it('treats backslashes as separators', () => {
    strictEqual(dirname('\\foo\\bar'), '/foo');
  });

  it('handles drive-relative paths', () => {
    strictEqual(dirname('C:foo'), 'C:');
  });
});
