import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readDir } from '../../../src/utils/fs/index.ts';

describe('readDir', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-read-dir-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every name, hidden ones and dangling symlinks included', async () => {
    const d = join(dir, 'full');
    mkdirSync(join(d, 'sub'), { recursive: true });
    writeFileSync(join(d, '.env'), 'x');
    symlinkSync(join(dir, 'nowhere'), join(d, 'link'));

    deepStrictEqual((await readDir(d))?.sort(), ['.env', 'link', 'sub']);
  });

  it('returns [] for an existing but empty directory', async () => {
    const d = join(dir, 'empty');
    mkdirSync(d);
    deepStrictEqual(await readDir(d), []);
  });

  it('returns null when the directory is missing', async () => {
    strictEqual(await readDir(join(dir, 'missing')), null);
  });

  it('propagates non-ENOENT errors', async () => {
    const f = join(dir, 'file.txt');
    writeFileSync(f, 'x');
    await rejects(readDir(f), /ENOTDIR/);
  });
});
