import { deepStrictEqual, match, strictEqual } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';

import pkg from '../../../../package.json' with { type: 'json' };
import { ohne } from '../../../../src/ohne/cli/ohne.ts';
import { usePrinter } from '../../../../src/ohne/index.ts';
import { runCommand } from '../../../../src/utils/cli/index.ts';
import { isUndefined } from '../../../../src/utils/index.ts';

describe('ohne init', () => {
  let root: string;

  function freshDir(name: string): string {
    return mkdtempSync(join(root, `${name}-`));
  }

  async function initAs(userAgent: string | undefined, argv: string[]): Promise<string> {
    const saved = process.env.npm_config_user_agent;
    const output: string[] = [];
    if (isUndefined(userAgent)) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = userAgent;
    usePrinter().configure({
      silent: false,
      color: false,
      stream: { write: (s) => output.push(s) },
    });
    try {
      await runCommand(ohne, ['init', ...argv]);
    } finally {
      usePrinter().configure({ silent: true, stream: process.stderr });
      if (isUndefined(saved)) delete process.env.npm_config_user_agent;
      else process.env.npm_config_user_agent = saved;
    }
    return output.join('');
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
    strictEqual(existsSync(join(dir, '.gitignore')), true);
  });

  it('names the package after the target directory', async () => {
    const dir = join(freshDir('app'), 'widgets');

    await runCommand(ohne, ['init', dir, '--yes']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.name, 'widgets');
    strictEqual(manifest.dependencies.ohnejs.startsWith('^'), false);
  });

  it('pins the toolchain ohne itself is checked against', async () => {
    const dir = join(freshDir('app'), 'typed');

    await runCommand(ohne, ['init', dir, '--yes']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    deepStrictEqual(manifest.devDependencies, {
      '@types/node': pkg.devDependencies['@types/node'],
      typescript: pkg.devDependencies.typescript,
    });
    deepStrictEqual(manifest.engines, pkg.engines);
    strictEqual(manifest.scripts.typecheck, 'tsc');
  });

  it('lets `--name` override the package name', async () => {
    const dir = join(freshDir('app'), 'widgets');

    await runCommand(ohne, ['init', dir, '--yes', '--name', '@acme/ui']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.name, '@acme/ui');
  });

  it('lets `--pm` pick the package manager in the next steps', async () => {
    const dir = join(freshDir('app'), 'managed');
    const output: string[] = [];

    usePrinter().configure({
      silent: false,
      color: false,
      stream: { write: (s) => output.push(s) },
    });
    await runCommand(ohne, ['init', dir, '--yes', '--pm', 'npm']);
    usePrinter().configure({ silent: true, stream: process.stderr });
    match(output.join(''), /\bnpm install/);
    match(output.join(''), /\bnpm run dev/);
  });

  it('defaults to pnpm when pnpm launched it, else npm', async () => {
    const cases: [string | undefined, RegExp][] = [
      ['pnpm/11.5.1 npm/? node/v26.3.0', /\bpnpm dev$/m],
      ['npm/11.16.0 node/v26.3.0', /\bnpm run dev$/m],
      ['bun/1.2.19 npm/? node/v24.3.0', /\bnpm run dev$/m],
      [undefined, /\bnpm run dev$/m],
    ];
    for (const [agent, step] of cases) {
      match(await initAs(agent, [join(freshDir('pm'), 'app'), '--yes']), step, String(agent));
    }
  });

  it('tells npm users to put flags after `--` when an argument is unexpected', async () => {
    const argv = [join(freshDir('hint'), 'app'), 'x', '--yes'];
    const npm = await initAs('npm/11.16.0 node/v26.3.0', argv);
    const pnpm = await initAs('pnpm/11.5.1 npm/? node/v26.3.0', argv);
    process.exitCode = 0;

    match(
      npm,
      /Unexpected argument x\n[^]*\n│\n│  With npm, flags go after --: npm create ohne my-app -- --yes\./,
    );
    match(pnpm, /Unexpected argument x/);
    strictEqual(pnpm.includes('With npm'), false);
  });

  it('quotes the directory in the `cd` step', async () => {
    const cwd = process.cwd();
    const output: string[] = [];

    process.chdir(freshDir('cwd'));
    usePrinter().configure({
      silent: false,
      color: false,
      stream: { write: (s) => output.push(s) },
    });
    try {
      await runCommand(ohne, ['init', 'my app', '--yes']);
      await runCommand(ohne, ['init', '--yes', '--', '-dash']);
    } finally {
      usePrinter().configure({ silent: true, stream: process.stderr });
      process.chdir(cwd);
    }
    match(output.join(''), /\bcd 'my app'$/m);
    match(output.join(''), /\bcd \.\/-dash$/m);
  });

  it(
    'reads a leading `~` as the home directory',
    { skip: process.platform === 'win32' },
    async () => {
      const cwd = process.cwd();
      const home = process.env.HOME;
      const dir = freshDir('home');

      process.chdir(freshDir('cwd'));
      process.env.HOME = dir;
      try {
        await runCommand(ohne, ['init', '~/x', '--yes']);
        deepStrictEqual(readdirSync(process.cwd()), []);
      } finally {
        process.env.HOME = home;
        process.chdir(cwd);
      }
      strictEqual(existsSync(join(dir, 'x', 'ohne.config.ts')), true);
    },
  );

  it('derives a valid package name from the directory name', async () => {
    const parent = freshDir('app');
    const nameOf = (dir: string): string =>
      JSON.parse(readFileSync(join(parent, dir, 'package.json'), 'utf8')).name;

    await runCommand(ohne, ['init', join(parent, 'My App'), '--yes']);
    await runCommand(ohne, ['init', join(parent, 'my_app.v2'), '--yes']);
    strictEqual(nameOf('My App'), 'my-app');
    strictEqual(nameOf('my_app.v2'), 'my_app.v2');
  });

  it('refuses what it cannot scaffold before touching anything, and exits 1', async () => {
    const cwd = process.cwd();
    const cases: [string[], RegExp][] = [
      [['my', 'app'], /Unexpected argument app\n[^]*'my app'/],
      [['my\napp'], /Arguments cannot hold control characters/],
      [['--name', 'Foo Bar'], /Invalid package name Foo Bar/],
      [[], /Invalid package name 日本\n[^]*--name/],
    ];
    for (const [argv, title] of cases) {
      const dir = join(freshDir('refuse'), '日本');
      const output: string[] = [];
      mkdirSync(dir);
      writeFileSync(join(dir, 'keep.txt'), 'mine');
      process.chdir(dir);
      usePrinter().configure({
        silent: false,
        color: false,
        stream: { write: (s) => output.push(s) },
      });
      try {
        await runCommand(ohne, ['init', ...argv, '--yes', '--force']);
      } finally {
        usePrinter().configure({ silent: true, stream: process.stderr });
        process.chdir(cwd);
      }
      strictEqual(process.exitCode, 1, argv.join(' '));
      match(output.join(''), title);
      strictEqual(output.join('').includes('my\napp'), false);
      deepStrictEqual(readdirSync(dir), ['keep.txt'], argv.join(' '));
      process.exitCode = 0;
    }
  });

  it('empties the current directory in place with `--force`', async () => {
    const cwd = process.cwd();
    const dir = freshDir('here');
    writeFileSync(join(dir, 'stale.txt'), 'x');
    const inode = statSync(dir).ino;

    process.chdir(dir);
    try {
      await runCommand(ohne, ['init', '.', '--yes', '--force']);
      strictEqual(statSync(process.cwd()).ino, inode);
    } finally {
      process.chdir(cwd);
    }
    strictEqual(existsSync(join(dir, 'stale.txt')), false);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
  });

  it('points the ohne dependency at a local path with --ohne-path', async () => {
    const dir = join(freshDir('app'), 'linked');

    await runCommand(ohne, ['init', dir, '--yes', '--ohne-path', '../ohne']);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    strictEqual(manifest.dependencies.ohnejs, '../ohne');
  });

  it('extends the published base config from tsconfig.json', async () => {
    const dir = join(freshDir('app'), 'cfg');

    await runCommand(ohne, ['init', dir, '--yes']);
    const tsconfig = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
    strictEqual(tsconfig.extends, 'ohnejs/tsconfig.node.json');
    deepStrictEqual(tsconfig.include, ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts']);
    deepStrictEqual(tsconfig.exclude, ['dashboard']);
  });

  it('does not scaffold a dashboard folder', async () => {
    const dir = join(freshDir('app'), 'browser');

    await runCommand(ohne, ['init', dir, '--yes']);
    strictEqual(existsSync(join(dir, 'dashboard')), false);
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

  it(
    'counts a symlink as content to refuse or purge',
    { skip: process.platform === 'win32' },
    async () => {
      const dir = freshDir('app');
      const kept = join(freshDir('kept'), 'keep.txt');
      writeFileSync(kept, 'mine');
      symlinkSync(kept, join(dir, 'link'));

      await runCommand(ohne, ['init', dir, '--yes']);
      strictEqual(process.exitCode, 1);
      strictEqual(existsSync(join(dir, 'ohne.config.ts')), false);
      process.exitCode = 0;

      await runCommand(ohne, ['init', dir, '--yes', '--force']);
      strictEqual(readdirSync(dir).includes('link'), false);
      strictEqual(readFileSync(kept, 'utf8'), 'mine');
    },
  );

  it('skips the git prompt on a TTY when `--no-git` answers it', async () => {
    const dir = join(freshDir('app'), 'flagged');
    const { isTTY } = process.stdin;
    const path = process.env.PATH;
    const output: string[] = [];
    const passThrough = process.stdout.write.bind(process.stdout);
    const write = mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
      // The runner reports earlier tests as bytes on this stream; only the prompt writes strings.
      if (typeof chunk !== 'string') return passThrough(chunk);
      output.push(chunk);
      // Answers any prompt, so a regression fails the assertion instead of hanging.
      if (chunk.includes('?')) {
        setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
      }
      return true;
    });

    process.stdin.isTTY = true;
    // An empty `PATH` makes the TTY-only install fail at once instead of running npm.
    process.env.PATH = '';
    try {
      await runCommand(ohne, ['init', dir, '--name', 'flagged', '--pm', 'npm', '--no-git']);
    } finally {
      process.env.PATH = path;
      write.mock.restore();
      process.stdin.isTTY = isTTY;
    }
    strictEqual(output.join('').includes('git repository'), false);
  });

  it('purges a non-empty directory with --force', async () => {
    const dir = freshDir('app');
    writeFileSync(join(dir, 'stale.txt'), 'old');

    await runCommand(ohne, ['init', dir, '--yes', '--force']);
    strictEqual(existsSync(join(dir, 'stale.txt')), false);
    strictEqual(existsSync(join(dir, 'ohne.config.ts')), true);
  });
});
