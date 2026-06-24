import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { safeResolve } from '../../../src/utils/index.ts';

describe('safeResolve', () => {
  it('resolves a relative path inside the base', () => {
    strictEqual(safeResolve('/srv/files', 'a/b.txt'), '/srv/files/a/b.txt');
  });

  it('collapses interior `..` that stays inside the base', () => {
    strictEqual(safeResolve('/srv/files', 'a/../b.txt'), '/srv/files/b.txt');
  });

  it('allows the base itself', () => {
    strictEqual(safeResolve('/srv/files', ''), '/srv/files');
    strictEqual(safeResolve('/srv/files', '.'), '/srv/files');
  });

  it('refuses an escape via `..`', () => {
    strictEqual(safeResolve('/srv/files', '../etc/passwd'), null);
    strictEqual(safeResolve('/srv/files', 'a/../../etc'), null);
  });

  it('refuses an absolute path', () => {
    strictEqual(safeResolve('/srv/files', '/etc/passwd'), null);
  });

  it('refuses a sibling that shares the base prefix', () => {
    strictEqual(safeResolve('/srv/files', '../files-secret/x'), null);
  });
});
