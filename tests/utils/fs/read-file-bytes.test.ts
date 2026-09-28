import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readFileBytes } from '../../../src/utils/fs/index.ts';

describe('readFileBytes', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-read-file-bytes-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads raw bytes', async () => {
    const f = join(dir, 'a.bin');
    writeFileSync(f, Uint8Array.of(0, 159, 146, 150));
    deepStrictEqual(new Uint8Array((await readFileBytes(f))!), Uint8Array.of(0, 159, 146, 150));
  });

  it('returns null when the file is missing', async () => {
    strictEqual(await readFileBytes(join(dir, 'missing')), null);
  });

  it('returns null for a path beneath a file', async () => {
    const f = join(dir, 'file.txt');
    writeFileSync(f, 'x');
    strictEqual(await readFileBytes(join(f, 'child')), null);
  });

  it('propagates non-ENOENT errors', async () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return;
    const f = join(dir, 'denied');
    writeFileSync(f, 'x');
    chmodSync(f, 0o000);
    try {
      await rejects(readFileBytes(f), /EACCES|EPERM/);
    } finally {
      chmodSync(f, 0o600);
    }
  });
});
