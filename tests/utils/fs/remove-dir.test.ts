import { strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { removeDir } from '../../../src/utils/fs/index.ts';

describe('removeDir', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-remove-dir-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes an empty directory', async () => {
    const d = join(dir, 'empty');
    mkdirSync(d);
    await removeDir(d);
    strictEqual(existsSync(d), false);
  });

  it('removes a directory and its contents recursively', async () => {
    const d = join(dir, 'tree');
    mkdirSync(join(d, 'a', 'b'), { recursive: true });
    writeFileSync(join(d, 'a', 'b', 'leaf.txt'), 'x');
    writeFileSync(join(d, 'top.txt'), 'y');
    await removeDir(d);
    strictEqual(existsSync(d), false);
  });

  it('is silent when the directory is already gone', async () => {
    await removeDir(join(dir, 'missing'));
  });
});
