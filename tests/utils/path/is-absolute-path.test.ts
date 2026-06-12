import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isAbsolutePath } from '../../../src/utils/index.ts';

describe('isAbsolutePath', () => {
  it('returns false for an empty string', () => {
    strictEqual(isAbsolutePath(''), false);
  });

  it('returns true for a POSIX root', () => {
    strictEqual(isAbsolutePath('/'), true);
    strictEqual(isAbsolutePath('/foo'), true);
  });

  it('returns true for a backslash root', () => {
    strictEqual(isAbsolutePath('\\foo'), true);
  });

  it('returns false for relative paths', () => {
    strictEqual(isAbsolutePath('foo'), false);
    strictEqual(isAbsolutePath('./foo'), false);
    strictEqual(isAbsolutePath('../foo'), false);
  });

  it('returns true for a Windows drive absolute path', () => {
    strictEqual(isAbsolutePath('C:/foo'), true);
    strictEqual(isAbsolutePath('C:\\foo'), true);
    strictEqual(isAbsolutePath('c:/foo'), true);
  });

  it('returns false for a drive-relative path', () => {
    strictEqual(isAbsolutePath('C:foo'), false);
    strictEqual(isAbsolutePath('C:'), false);
  });

  it('returns true for a UNC path', () => {
    strictEqual(isAbsolutePath('//srv/sh'), true);
    strictEqual(isAbsolutePath('\\\\srv\\sh'), true);
  });

  it('returns false for a non-drive-letter colon prefix', () => {
    strictEqual(isAbsolutePath('1:/foo'), false);
    strictEqual(isAbsolutePath('::/foo'), false);
  });
});
