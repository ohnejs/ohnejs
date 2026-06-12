import { rejects, strictEqual } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readFile } from '../../../src/utils/fs/index.ts';

describe('readFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-read-file-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a UTF-8 file', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello');
    strictEqual(await readFile(f), 'hello');
  });

  it('returns null when the file is missing', async () => {
    strictEqual(await readFile(join(dir, 'missing')), null);
  });

  it('propagates non-ENOENT errors', async () => {
    if (process.getuid?.() === 0) return;
    const f = join(dir, 'denied');
    writeFileSync(f, 'x');
    chmodSync(f, 0o000);
    try {
      await rejects(readFile(f), /EACCES|EPERM/);
    } finally {
      chmodSync(f, 0o600);
    }
  });
});
