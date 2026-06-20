import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { compileGlob } from '../../../src/utils/index.ts';

describe('compileGlob', () => {
  it('matches a literal string', () => {
    const m = compileGlob('/users');
    strictEqual(m('/users'), true);
    strictEqual(m('/users/1'), false);
  });

  it('treats * as a single segment wildcard', () => {
    const m = compileGlob('/users/*');
    strictEqual(m('/users/1'), true);
    strictEqual(m('/users/1/posts'), false);
  });

  it('treats ** as a cross-segment wildcard', () => {
    const m = compileGlob('/admin/**');
    strictEqual(m('/admin/users'), true);
    strictEqual(m('/admin/users/1'), true);
    strictEqual(m('/admin'), false);
  });

  it('treats ? as a single character', () => {
    const m = compileGlob('/users/?');
    strictEqual(m('/users/1'), true);
    strictEqual(m('/users/12'), false);
    strictEqual(m('/users/'), false);
  });

  it('matches an extension glob', () => {
    const m = compileGlob('*.ts');
    strictEqual(m('index.ts'), true);
    strictEqual(m('nested/index.ts'), false);
  });

  it('escapes regex metacharacters', () => {
    const m = compileGlob('/a.b+c');
    strictEqual(m('/a.b+c'), true);
    strictEqual(m('/axbxc'), false);
  });

  it('anchors the whole input', () => {
    const m = compileGlob('/api/users');
    strictEqual(m('/api/users'), true);
    strictEqual(m('prefix/api/users/suffix'), false);
  });

  it('exposes the source and regex', () => {
    const m = compileGlob('/admin/**');
    strictEqual(m.source, '/admin/**');
    strictEqual(m.regex instanceof RegExp, true);
  });
});
