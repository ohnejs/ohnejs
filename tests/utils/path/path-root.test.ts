import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathRoot } from '../../../src/utils/index.ts';

describe('pathRoot', () => {
  it('returns an empty string for an empty input', () => {
    strictEqual(pathRoot(''), '');
  });

  it('returns an empty string for a relative path', () => {
    strictEqual(pathRoot('foo/bar'), '');
  });

  it('returns the POSIX root for an absolute path', () => {
    strictEqual(pathRoot('/foo/bar'), '/');
  });

  it('returns the drive root for a drive-absolute path', () => {
    strictEqual(pathRoot('C:/foo'), 'C:/');
    strictEqual(pathRoot('C:\\foo'), 'C:/');
  });

  it('returns the drive prefix for a drive-relative path', () => {
    strictEqual(pathRoot('C:foo'), 'C:');
  });

  it('returns the UNC server+share for a UNC path', () => {
    strictEqual(pathRoot('//srv/sh/foo'), '//srv/sh');
    strictEqual(pathRoot('\\\\srv\\sh\\foo'), '//srv/sh');
  });
});
