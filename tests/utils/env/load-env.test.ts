import { deepStrictEqual, rejects } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadEnv } from '../../../src/utils/env/index.ts';

describe('loadEnv', () => {
  let dir: string;
  let originalCwd: string;

  before(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'ohne-load-env-'));
    process.chdir(dir);
  });

  after(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads `.env` from the current working directory by default', async () => {
    writeFileSync(join(dir, '.env'), 'FOO=bar\nBAZ=qux\n');
    deepStrictEqual(await loadEnv(), { FOO: 'bar', BAZ: 'qux' });
  });

  it('reads a custom relative path', async () => {
    writeFileSync(join(dir, '.env.local'), 'A=1\n');
    deepStrictEqual(await loadEnv('.env.local'), { A: '1' });
  });

  it('reads an absolute path', async () => {
    const abs = join(dir, '.env.abs');
    writeFileSync(abs, 'X=y\n');
    deepStrictEqual(await loadEnv(abs), { X: 'y' });
  });

  it('returns an empty object when the file is missing', async () => {
    deepStrictEqual(await loadEnv('.env.missing'), {});
  });

  it('returns an empty object for an empty file', async () => {
    writeFileSync(join(dir, '.env.empty'), '');
    deepStrictEqual(await loadEnv('.env.empty'), {});
  });

  it('propagates parse errors from malformed input', async () => {
    writeFileSync(join(dir, '.env.bad'), 'NOEQUALS\n');
    await rejects(loadEnv('.env.bad'), /Invalid env/);
  });

  it('propagates non-ENOENT read errors', async () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return;
    const denied = join(dir, '.env.denied');
    writeFileSync(denied, 'A=1\n');
    chmodSync(denied, 0o000);
    try {
      await rejects(loadEnv(denied), /EACCES|EPERM/);
    } finally {
      chmodSync(denied, 0o600);
    }
  });
});
