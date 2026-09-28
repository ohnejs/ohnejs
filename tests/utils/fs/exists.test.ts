import { rejects, strictEqual } from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exists } from '../../../src/utils/fs/index.ts';

describe('exists', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-exists-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns true for an existing file', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x');
    strictEqual(await exists(f), true);
  });

  it('returns true for an existing directory', async () => {
    const d = join(dir, 'sub');
    mkdirSync(d);
    strictEqual(await exists(d), true);
  });

  it('returns false for a missing path', async () => {
    strictEqual(await exists(join(dir, 'missing')), false);
  });

  it('returns false for a path beneath a file', async () => {
    const f = join(dir, 'file.txt');
    writeFileSync(f, 'x');
    strictEqual(await exists(join(f, 'child')), false);
  });

  it('propagates permission errors', async () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return;
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    const inside = join(locked, 'file');
    writeFileSync(inside, 'x');
    chmodSync(locked, 0o000);
    try {
      await rejects(exists(inside), /EACCES|EPERM/);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});
