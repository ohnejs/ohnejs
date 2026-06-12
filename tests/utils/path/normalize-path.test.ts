import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { normalizePath } from '../../../src/utils/index.ts';

describe('normalizePath', () => {
  it('returns `.` for an empty string', () => {
    strictEqual(normalizePath(''), '.');
  });

  it('returns `.` for `.`', () => {
    strictEqual(normalizePath('.'), '.');
  });

  it('returns `..` for `..`', () => {
    strictEqual(normalizePath('..'), '..');
  });

  it('strips leading `./`', () => {
    strictEqual(normalizePath('./foo'), 'foo');
  });

  it('strips a trailing slash', () => {
    strictEqual(normalizePath('foo/'), 'foo');
  });

  it('collapses repeated slashes', () => {
    strictEqual(normalizePath('foo//bar'), 'foo/bar');
  });

  it('collapses repeated slashes anywhere in the path', () => {
    strictEqual(normalizePath('foo///bar////baz'), 'foo/bar/baz');
  });

  it('drops `.` segments', () => {
    strictEqual(normalizePath('foo/./bar'), 'foo/bar');
  });

  it('resolves `..` segments', () => {
    strictEqual(normalizePath('foo/bar/../baz'), 'foo/baz');
  });

  it('keeps the root for absolute paths', () => {
    strictEqual(normalizePath('/'), '/');
  });

  it('clamps `..` escapes to the absolute root', () => {
    strictEqual(normalizePath('/foo/../..'), '/');
  });

  it('keeps trailing `..` in a relative path', () => {
    strictEqual(normalizePath('foo/../..'), '..');
  });

  it('keeps several `..` at the start of a relative path', () => {
    strictEqual(normalizePath('../../foo'), '../../foo');
  });

  it('converts backslashes to forward slashes', () => {
    strictEqual(normalizePath('\\foo\\bar'), '/foo/bar');
  });

  it('preserves a Windows drive prefix and case', () => {
    strictEqual(normalizePath('C:\\foo\\bar'), 'C:/foo/bar');
    strictEqual(normalizePath('c:/foo/bar'), 'c:/foo/bar');
  });

  it('resolves `..` against a Windows drive root', () => {
    strictEqual(normalizePath('C:/foo/../bar'), 'C:/bar');
  });

  it('keeps a drive-relative path drive-relative', () => {
    strictEqual(normalizePath('C:foo/bar'), 'C:foo/bar');
  });

  it('preserves a UNC server+share prefix', () => {
    strictEqual(normalizePath('//server/share/foo'), '//server/share/foo');
  });

  it('resolves `..` against a UNC share root', () => {
    strictEqual(normalizePath('//server/share/a/../b'), '//server/share/b');
    strictEqual(normalizePath('//server/share/a/../..'), '//server/share');
  });

  it('normalizes a UNC root with a trailing slash', () => {
    strictEqual(normalizePath('//server/share/'), '//server/share');
  });

  it('treats backslash-form UNC the same as forward-slash form', () => {
    strictEqual(normalizePath('\\\\server\\share\\foo'), '//server/share/foo');
  });
});
