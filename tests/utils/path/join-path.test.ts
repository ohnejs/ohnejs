import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { joinPath } from '../../../src/utils/index.ts';

describe('joinPath', () => {
  it('returns `.` with no arguments', () => {
    strictEqual(joinPath(), '.');
  });

  it('returns `.` when every argument is empty', () => {
    strictEqual(joinPath('', '', ''), '.');
  });

  it('joins simple segments', () => {
    strictEqual(joinPath('foo', 'bar', 'baz'), 'foo/bar/baz');
  });

  it('skips empty segments', () => {
    strictEqual(joinPath('foo', '', 'bar'), 'foo/bar');
  });

  it('collapses the slashes at each segment boundary', () => {
    strictEqual(joinPath('/foo/', '/bar/', 'baz'), '/foo/bar/baz');
  });

  it('resolves `..` across segments', () => {
    strictEqual(joinPath('foo', '..', 'bar'), 'bar');
  });

  it('keeps an absolute leading segment absolute', () => {
    strictEqual(joinPath('/foo', 'bar'), '/foo/bar');
  });

  it('converts backslashes in any segment', () => {
    strictEqual(joinPath('C:\\foo', 'bar'), 'C:/foo/bar');
  });

  it('preserves a UNC root when joining', () => {
    strictEqual(joinPath('//srv/sh', 'foo', 'bar'), '//srv/sh/foo/bar');
  });
});
