import { rejects, strictEqual } from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { stat } from '../../../src/utils/fs/index.ts';

describe('stat', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-stat-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads stats for a file', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello');
    const stats = await stat(f);
    strictEqual(stats?.size, 5);
    strictEqual(stats?.isFile(), true);
  });

  it('reports a directory', async () => {
    const d = join(dir, 'sub');
    mkdirSync(d);
    strictEqual((await stat(d))?.isDirectory(), true);
  });

  it('returns null when the path is missing', async () => {
    strictEqual(await stat(join(dir, 'missing')), null);
  });

  it('propagates non-ENOENT errors', async () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return;
    const denied = join(dir, 'denied');
    mkdirSync(denied);
    const f = join(denied, 'file');
    writeFileSync(f, 'x');
    chmodSync(denied, 0o000);
    try {
      await rejects(stat(f), /EACCES|EPERM/);
    } finally {
      chmodSync(denied, 0o700);
    }
  });
});
