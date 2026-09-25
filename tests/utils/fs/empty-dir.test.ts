import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { emptyDir } from '../../../src/utils/fs/index.ts';

describe('emptyDir', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-empty-dir-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes every entry, hidden ones and symlinks included, and keeps the directory itself', async () => {
    const d = join(dir, 'full');
    mkdirSync(join(d, 'a', 'b'), { recursive: true });
    writeFileSync(join(d, 'a', 'b', 'leaf.txt'), 'x');
    writeFileSync(join(d, '.env'), 'x');
    symlinkSync(join(d, 'a'), join(d, 'link'));
    const inode = statSync(d).ino;

    await emptyDir(d);
    deepStrictEqual(readdirSync(d), []);
    strictEqual(statSync(d).ino, inode);
  });

  it(
    'reads a backslash in a name literally, touching nothing outside',
    { skip: process.platform === 'win32' },
    async () => {
      const d = join(dir, 'escape', 'target');
      mkdirSync(join(dir, 'escape', 'victim'), { recursive: true });
      mkdirSync(d);
      writeFileSync(join(dir, 'escape', 'victim', 'keep.txt'), 'x');
      writeFileSync(join(d, '..\\victim'), 'x');
      writeFileSync(join(d, '..\\..'), 'x');

      await emptyDir(d);
      deepStrictEqual(readdirSync(d), []);
      strictEqual(existsSync(join(dir, 'escape', 'victim', 'keep.txt')), true);
    },
  );

  it('empties the directory a `..` after a symlink leads to', async () => {
    const base = join(dir, 'lexical');
    mkdirSync(join(base, 'real', 'sub'), { recursive: true });
    mkdirSync(join(base, 'real', 't'));
    mkdirSync(join(base, 't'));
    writeFileSync(join(base, 'real', 't', 'one.txt'), 'x');
    writeFileSync(join(base, 't', 'keep.txt'), 'x');
    symlinkSync(join(base, 'real', 'sub'), join(base, 'link'));

    await emptyDir(`${base}/link/../t`);
    deepStrictEqual(readdirSync(join(base, 'real', 't')), []);
    deepStrictEqual(readdirSync(join(base, 't')), ['keep.txt']);
  });

  it('removes a symlink that leads outside without touching what it points to', async () => {
    const outside = join(dir, 'outside');
    const d = join(dir, 'linked');
    mkdirSync(outside);
    mkdirSync(d);
    writeFileSync(join(outside, 'keep.txt'), 'x');
    symlinkSync(outside, join(d, 'dir-link'));
    symlinkSync(join(outside, 'keep.txt'), join(d, 'file-link'));

    await emptyDir(d);
    deepStrictEqual(readdirSync(d), []);
    deepStrictEqual(readdirSync(outside), ['keep.txt']);
  });

  it('is silent when nothing exists there', async () => {
    await emptyDir(join(dir, 'missing'));
    strictEqual(existsSync(join(dir, 'missing')), false);
  });
});
