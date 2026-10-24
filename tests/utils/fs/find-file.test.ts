import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { findFile } from '../../../src/utils/fs/index.ts';

describe('findFile', () => {
  let dir: string;
  let first: string;
  let second: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-find-file-'));
    first = join(dir, 'first');
    second = join(dir, 'second');
    mkdirSync(join(first, 'tome'), { recursive: true });
    mkdirSync(join(second, 'scroll'), { recursive: true });
    writeFileSync(join(first, 'scroll'), 'Medivh');
    writeFileSync(join(second, 'scroll', 'page.txt'), 'Khadgar');
    writeFileSync(join(second, 'tome'), 'Antonidas');
    writeFileSync(join(second, 'map.txt'), 'Dalaran');
    symlinkSync(join(second, 'map.txt'), join(first, 'link.txt'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the file in the first root that holds it', async () => {
    const found = await findFile([first, second], 'scroll');
    strictEqual(found?.path, join(first, 'scroll'));
    strictEqual(found?.stats.size, 'Medivh'.length);
  });

  it('passes a root where a file stands in the path', async () => {
    strictEqual(
      (await findFile([first, second], 'scroll/page.txt'))?.path,
      join(second, 'scroll', 'page.txt'),
    );
  });

  it('passes a root where the path is a directory', async () => {
    strictEqual((await findFile([first, second], 'tome'))?.path, join(second, 'tome'));
  });

  it('follows a symlink, keeping the path under its root', async () => {
    const found = await findFile([first], 'link.txt');
    strictEqual(found?.path, join(first, 'link.txt'));
    strictEqual(found?.stats.size, 'Dalaran'.length);
  });

  it('finds nothing for a path that escapes its root', async () => {
    for (const path of ['../second/map.txt', join(second, 'map.txt')]) {
      strictEqual(await findFile([first], path), null);
    }
  });

  it('finds nothing for a path that names no file', async () => {
    for (const path of ['a\0b', 'x'.repeat(300), 'scroll/page.txt/x', 'missing']) {
      strictEqual(await findFile([first, second], path), null);
    }
  });
});
