import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { listDir } from '../../../src/utils/fs/index.ts';

describe('listDir', () => {
  let dir: string;
  let originalCwd: string;

  before(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'ohne-list-dir-'));
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'top.ts'), '');
    writeFileSync(join(dir, 'top.md'), '');
    writeFileSync(join(dir, '.hidden'), '');
    writeFileSync(join(dir, 'a', 'mid.ts'), '');
    writeFileSync(join(dir, 'a', 'b', 'deep.ts'), '');
  });

  after(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists files recursively by default', async () => {
    const entries = await listDir(dir);
    const names = new Set(entries!.map((entry) => entry.name));
    deepStrictEqual(names, new Set(['top.ts', 'top.md', 'mid.ts', 'deep.ts']));
  });

  it('returns rich entry shape with normalized paths', async () => {
    const entries = await listDir(dir, { ext: 'ts', depth: 0 });
    const entry = entries!.find((value) => value.name === 'top.ts');
    strictEqual(entry?.type, 'file');
    strictEqual(entry?.stem, 'top');
    strictEqual(entry?.ext, '.ts');
    strictEqual(entry?.relativePath, 'top.ts');
    strictEqual(entry?.path.includes('\\'), false);
    strictEqual(entry?.path.endsWith('/top.ts'), true);
  });

  it('honors depth=0 (root level only)', async () => {
    const entries = await listDir(dir, { depth: 0 });
    const names = new Set(entries!.map((entry) => entry.name));
    deepStrictEqual(names, new Set(['top.ts', 'top.md']));
  });

  it('honors depth=1 (one level of subdirs)', async () => {
    const entries = await listDir(dir, { depth: 1 });
    const names = new Set(entries!.map((entry) => entry.name));
    deepStrictEqual(names, new Set(['top.ts', 'top.md', 'mid.ts']));
  });

  it('filters by a single extension string', async () => {
    const entries = await listDir(dir, { ext: 'ts' });
    deepStrictEqual(entries!.map((entry) => entry.name).sort(), ['deep.ts', 'mid.ts', 'top.ts']);
  });

  it('accepts extensions with or without a leading dot', async () => {
    const dot = await listDir(dir, { ext: ['.ts'] });
    const bare = await listDir(dir, { ext: ['ts'] });
    deepStrictEqual(
      dot!.map((entry) => entry.name).sort(),
      bare!.map((entry) => entry.name).sort(),
    );
  });

  it('returns directories when `dirs: true`', async () => {
    const entries = await listDir(dir, { files: false, dirs: true });
    const dirs = entries!.filter((entry) => entry.type === 'directory').map((entry) => entry.name);
    deepStrictEqual(dirs.sort(), ['a', 'b']);
  });

  it('skips hidden files by default and includes them with `hidden: true`', async () => {
    const without = await listDir(dir, { depth: 0 });
    strictEqual(
      without!.some((entry) => entry.name === '.hidden'),
      false,
    );

    const withHidden = await listDir(dir, { depth: 0, hidden: true });
    strictEqual(
      withHidden!.some((entry) => entry.name === '.hidden'),
      true,
    );
  });

  it('applies the custom filter predicate', async () => {
    const entries = await listDir(dir, { filter: (entry) => entry.stem.startsWith('top') });
    const names = entries!.map((entry) => entry.name).sort();
    deepStrictEqual(names, ['top.md', 'top.ts']);
  });

  it(
    'skips symlinks unless `followSymlinks: true`',
    { skip: process.platform === 'win32' },
    async () => {
      const linkRoot = mkdtempSync(join(tmpdir(), 'ohne-list-dir-link-'));
      try {
        const target = join(linkRoot, 'target.ts');
        writeFileSync(target, '');
        symlinkSync(target, join(linkRoot, 'link.ts'));

        const skipped = await listDir(linkRoot);
        deepStrictEqual(skipped!.map((entry) => entry.name).sort(), ['target.ts']);

        const followed = await listDir(linkRoot, { followSymlinks: true });
        deepStrictEqual(followed!.map((entry) => entry.name).sort(), ['link.ts', 'target.ts']);
      } finally {
        rmSync(linkRoot, { recursive: true, force: true });
      }
    },
  );

  it('resolves a relative `path` against the current working directory', async () => {
    process.chdir(dir);
    const entries = await listDir('.', { depth: 0 });
    const names = new Set(entries!.map((entry) => entry.name));
    deepStrictEqual(names, new Set(['top.ts', 'top.md']));
    process.chdir(originalCwd);
  });

  it('returns null when the root directory does not exist', async () => {
    strictEqual(await listDir(join(dir, 'missing')), null);
  });

  it('returns [] for an existing but empty directory', async () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    deepStrictEqual(await listDir(empty), []);
  });
});
