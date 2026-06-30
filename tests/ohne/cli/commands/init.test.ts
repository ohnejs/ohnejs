import { deepStrictEqual, strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ohne } from '../../../../src/ohne/cli/ohne.ts';
import { usePrinter } from '../../../../src/ohne/index.ts';
import { runCommand } from '../../../../src/utils/cli/index.ts';

describe('ohne init', () => {
  let root: string;

  function freshDir(name: string): string {
    return mkdtempSync(join(root, `${name}-`));
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-init-'));
    usePrinter().configure({ silent: true });
    process.exitCode = 0;
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    usePrinter().configure({ silent: false });
    process.exitCode = 0;
  });

  it('scaffolds the project files into a new directory', async () => {
    const dir = join(freshDir('app'), 'my-app');

    const code = await runCommand(ohne, ['init', dir, '--yes']);
    strictEqual(code, 0);
    strictEqual(process.exitCode, 0);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
    strictEqual(existsSync(join(dir, 'package.json')), true);
    strictEqual(existsSync(join(dir, 'tsconfig.json')), true);
    strictEqual(existsSync(join(dir, 'tsconfig.browser.json')), true);
    strictEqual(existsSync(join(dir, '.gitignore')), true);
  });

  it('names the package after the target directory', async () => {
    const dir = join(freshDir('app'), 'widgets');

    await runCommand(ohne, ['init', dir, '--yes']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.name, 'widgets');
    strictEqual(manifest.dependencies.ohne.startsWith('^'), false);
  });

  it('installs the types the base config requires', async () => {
    const dir = join(freshDir('app'), 'typed');

    await runCommand(ohne, ['init', dir, '--yes']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.devDependencies['@types/node'].startsWith('^'), false);
    strictEqual(manifest.devDependencies.typescript.startsWith('^'), false);
    strictEqual(manifest.scripts.typecheck, 'tsc');
  });

  it('lets `--name` override the package name', async () => {
    const dir = join(freshDir('app'), 'widgets');

    await runCommand(ohne, ['init', dir, '--yes', '--name', '@acme/ui']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.name, '@acme/ui');
  });

  it('points the ohne dependency at a local path with --ohne-path', async () => {
    const dir = join(freshDir('app'), 'linked');

    await runCommand(ohne, ['init', dir, '--yes', '--ohne-path', '../ohne']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.dependencies.ohne, '../ohne');
  });

  it('extends the published base config from tsconfig.json', async () => {
    const dir = join(freshDir('app'), 'cfg');

    await runCommand(ohne, ['init', dir, '--yes']);
    const tsconfig = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
    strictEqual(tsconfig.extends, 'ohne/tsconfig.base.json');
    deepStrictEqual(tsconfig.exclude, ['dashboard']);
  });

  it('writes a browser tsconfig for the dashboard code', async () => {
    const dir = join(freshDir('app'), 'browser');

    await runCommand(ohne, ['init', dir, '--yes']);
    const tsconfig = JSON.parse(readFileSync(join(dir, 'tsconfig.browser.json'), 'utf8'));
    strictEqual(tsconfig.extends, 'ohne/tsconfig.base.json');
    deepStrictEqual(tsconfig.include, ['dashboard/**/*.ts']);
    deepStrictEqual(tsconfig.compilerOptions.lib, ['esnext', 'dom', 'dom.iterable']);
    deepStrictEqual(tsconfig.compilerOptions.types, []);
  });

  it('refuses a non-empty directory without --force and exits 1', async () => {
    const dir = freshDir('app');
    writeFileSync(join(dir, 'keep.txt'), 'mine');

    const code = await runCommand(ohne, ['init', dir, '--yes']);
    strictEqual(code, 0);
    strictEqual(process.exitCode, 1);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), false);
    strictEqual(existsSync(join(dir, 'keep.txt')), true);
    process.exitCode = 0;
  });

  it('purges a non-empty directory with --force', async () => {
    const dir = freshDir('app');
    writeFileSync(join(dir, 'stale.txt'), 'old');

    await runCommand(ohne, ['init', dir, '--yes', '--force']);
    strictEqual(existsSync(join(dir, 'stale.txt')), false);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
  });
});
