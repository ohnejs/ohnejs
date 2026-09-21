import { deepStrictEqual, match, rejects, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { loadProjectEnv, useEnv, usePrinter } from '../../../src/ohne/index.ts';

describe('loadProjectEnv', () => {
  let root: string;

  function app(name: string, env?: string): string {
    const dir = mkdtempSync(join(root, `${name}-`));
    if (env !== undefined) writeFileSync(join(dir, '.env'), env);
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-project-env-'));
    useEnv().set('NO_COLOR', true);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    useEnv().unset('NO_COLOR');
  });

  afterEach(() => {
    useEnv().fill({});
    delete process.env['OHNE_TEST_SHELL'];
  });

  it('fills the names the environment lacks and keeps the ones it has', async () => {
    process.env['OHNE_TEST_SHELL'] = 'shell';
    const dir = app('fill', 'OHNE_TEST_SHELL=file\nOHNE_TEST_FILE=file\n');
    deepStrictEqual(await loadProjectEnv(dir), ['OHNE_TEST_FILE']);
    strictEqual(process.env['OHNE_TEST_SHELL'], 'shell');
    strictEqual(process.env['OHNE_TEST_FILE'], 'file');
  });

  it('applies nothing without a `.env`', async () => {
    deepStrictEqual(await loadProjectEnv(app('bare')), []);
  });

  it('a repeat call mirrors the edited file', async () => {
    const dir = app('edit', 'OHNE_TEST_A=1\nOHNE_TEST_B=1\n');
    await loadProjectEnv(dir);
    writeFileSync(join(dir, '.env'), 'OHNE_TEST_A=2\n');
    deepStrictEqual(await loadProjectEnv(dir), ['OHNE_TEST_A']);
    strictEqual(process.env['OHNE_TEST_A'], '2');
    strictEqual(process.env['OHNE_TEST_B'], undefined);
  });

  it('rejects a malformed file with an `ohneError` naming it', async () => {
    const dir = app('bad', 'NOEQUALS\n');
    await rejects(loadProjectEnv(dir), (error: unknown) => {
      if (!isOhneError(error)) return false;
      strictEqual(error.title, 'Could not load `.env`');
      strictEqual(error.path, join(dir, '.env'));
      match(String(error.body), /expected "=" after key "NOEQUALS"/);
      return true;
    });
  });

  it('a `DEBUG` in the file enables its own loaded line', async () => {
    const out: string[] = [];
    usePrinter().configure({ stream: { write: (s: string) => out.push(s) } });
    try {
      await loadProjectEnv(app('debug', 'DEBUG=1\n'));
      match(out.join(''), /Loaded DEBUG from .*\.env/);
    } finally {
      usePrinter().configure({ stream: process.stderr });
    }
  });
});
