import { deepStrictEqual, throws } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadEnv } from '../../../src/ohne/index.ts';

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

  it('reads `.env` from the current working directory by default', () => {
    writeFileSync(join(dir, '.env'), 'FOO=bar\nBAZ=qux\n');
    deepStrictEqual(loadEnv(), { FOO: 'bar', BAZ: 'qux' });
  });

  it('reads a custom relative path', () => {
    writeFileSync(join(dir, '.env.local'), 'A=1\n');
    deepStrictEqual(loadEnv('.env.local'), { A: '1' });
  });

  it('reads an absolute path', () => {
    const abs = join(dir, '.env.abs');
    writeFileSync(abs, 'X=y\n');
    deepStrictEqual(loadEnv(abs), { X: 'y' });
  });

  it('returns an empty object when the file is missing', () => {
    deepStrictEqual(loadEnv('.env.missing'), {});
  });

  it('returns an empty object for an empty file', () => {
    writeFileSync(join(dir, '.env.empty'), '');
    deepStrictEqual(loadEnv('.env.empty'), {});
  });

  it('propagates parse errors from malformed input', () => {
    writeFileSync(join(dir, '.env.bad'), 'NOEQUALS\n');
    throws(() => loadEnv('.env.bad'), /Invalid env/);
  });

  it('propagates non-ENOENT read errors', () => {
    if (process.getuid?.() === 0) return; // root bypasses perms
    const denied = join(dir, '.env.denied');
    writeFileSync(denied, 'A=1\n');
    chmodSync(denied, 0o000);
    try {
      throws(() => loadEnv(denied), /EACCES|EPERM/);
    } finally {
      chmodSync(denied, 0o600);
    }
  });
});
