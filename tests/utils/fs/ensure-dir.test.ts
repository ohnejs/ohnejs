import { strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ensureDir } from '../../../src/utils/fs/index.ts';

describe('ensureDir', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-ensure-dir-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a missing directory', async () => {
    const target = join(dir, 'new');
    await ensureDir(target);
    strictEqual(statSync(target).isDirectory(), true);
  });

  it('creates missing parents', async () => {
    const target = join(dir, 'a', 'b', 'c');
    await ensureDir(target);
    strictEqual(statSync(target).isDirectory(), true);
  });

  it('is a no-op when the directory already exists', async () => {
    const target = join(dir, 'existing');
    await ensureDir(target);
    await ensureDir(target);
    strictEqual(existsSync(target), true);
  });
});
