import { doesNotMatch, match, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { version } from '../../../src/ohne/meta/version.ts';

const CREATE = join(import.meta.dirname, '..', '..', '..', 'src', 'ohne', 'cli', 'create.ts');
const ENTRY = `const { create } = await import(${JSON.stringify(CREATE)}); await create(process.argv.slice(1));`;

describe('create', () => {
  let root: string;

  function create(
    userAgent: string | undefined,
    ...args: string[]
  ): { status: number | null; output: string } {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
    for (const name of ['FORCE_COLOR', 'SILENT', 'DEBUG', 'npm_config_user_agent'])
      delete env[name];
    if (userAgent) env.npm_config_user_agent = userAgent;
    const argv = ['--input-type=module', '-e', ENTRY, '--', ...args];
    const result = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', env });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-create-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps exit code 1 when the scaffold refuses', () => {
    const dir = mkdtempSync(join(root, 'full-'));
    writeFileSync(join(dir, 'keep.txt'), 'mine');

    const { status, output } = create(undefined, dir, '--yes');
    strictEqual(status, 1);
    match(output, /Directory not empty/);
  });

  it('shows its own name, the directory, and only the scaffold globals in the help', () => {
    const { status, output } = create(undefined, '--help');
    strictEqual(status, 0);
    match(output, /^create-ohne /);
    match(output, /The one argument is its directory/);
    match(output, /--no-color/);
    doesNotMatch(output, /--port|--cwd/);
  });

  it('prints the ohnejs version it scaffolds', () => {
    strictEqual(create(undefined, '--version').output, `${version}\n`);
  });

  it('refuses an env flag outside the scaffold globals as unknown, whatever its value', () => {
    const { status, output } = create(undefined, join(root, 'port'), '--yes', '--port', '99999');
    strictEqual(status, 1);
    match(output, /Unknown flag `--port`/);
  });

  it('accepts the color flags', () => {
    const dir = join(root, 'plain');

    strictEqual(create(undefined, dir, '--yes', '--no-color').status, 0);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
  });

  it('drops the `--` that pnpm passes through', () => {
    const dir = join(root, 'pnpm');

    const { status, output } = create('pnpm/11.5.1 npm/? node/v26.3.0', dir, '--', '--yes');
    strictEqual(status, 0);
    match(output, /\bpnpm dev\b/);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
  });

  it('keeps `--` under npm, which already consumed its own', () => {
    const dir = join(root, 'npm');

    const { status, output } = create('npm/11.16.0 node/v26.3.0', dir, '--', '--yes');
    strictEqual(status, 1);
    match(output, /Unexpected argument --yes/);
    strictEqual(existsSync(dir), false);
  });
});
