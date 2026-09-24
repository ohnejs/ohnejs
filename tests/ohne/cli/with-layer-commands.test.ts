import {
  deepStrictEqual,
  doesNotMatch,
  match,
  ok,
  rejects,
  strictEqual,
  throws,
} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { Command } from '../../../src/utils/cli/index.ts';

import { ohne } from '../../../src/ohne/cli/ohne.ts';
import { withLayerCommands } from '../../../src/ohne/cli/with-layer-commands.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useShutdown } from '../../../src/ohne/lifecycle/use-shutdown.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { runCommand } from '../../../src/utils/cli/index.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');
const BUILTINS = Object.keys(ohne.subCommands ?? {});
const LICH_KING = "throw new Error('The Lich King stirs');\n";

const scope = globalThis as typeof globalThis & { __ohneCommandRan?: boolean };

describe('withLayerCommands', () => {
  const cwd = process.cwd();
  let root: string;
  let written = '';

  function write(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  function writePackage(dir: string, name: string, config: string, layers: string[] = []): void {
    const dependencies = Object.fromEntries(layers.map((layer) => [layer, '*']));
    write(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    write(join(dir, 'ohne.config.ts'), config);
  }

  function project(name: string, config = ''): string {
    const dir = join(root, name);
    writePackage(dir, name, config);
    return dir;
  }

  function command(
    dir: string,
    name: string,
    definition = `{ meta: { name: '${name}' }, run() {} }`,
  ): string {
    const file = join(dir, 'commands', `${name}.ts`);
    write(file, `export default ${definition};\n`);
    return file;
  }

  async function imported(file: string): Promise<Command> {
    return (await import(pathToFileURL(file).href)).default;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-with-layer-commands-')));
    useEnv().set('NO_COLOR', true);
    useEnv().set('DATABASE', ':memory:');
    usePrinter().configure({ stream: { write: (chunk: string) => ((written += chunk), true) } });
  });

  beforeEach(() => {
    written = '';
  });

  afterEach(async () => {
    await closeDatabases();
    useLayers().clear();
    useShutdown().clear();
    process.exitCode = 0;
  });

  after(() => {
    usePrinter().configure({ stream: process.stderr });
    useEnv().unset('NO_COLOR');
    useEnv().unset('DATABASE');
    rmSync(root, { recursive: true, force: true });
  });

  it('returns `root` itself for a built-in command, never importing the project config', async () => {
    const app = project('builtin', LICH_KING);

    strictEqual(await withLayerCommands(ohne, ['sync', '--cwd', app]), ohne);
    await rejects(withLayerCommands(ohne, ['--help', '--cwd', app]), /The Lich King stirs/);
  });

  it('returns `root` itself for a leading flag, loading the stack once `--help` joins it', async () => {
    const app = project('version', LICH_KING);

    strictEqual(await withLayerCommands(ohne, ['--version', '--cwd', app]), ohne);
    strictEqual(await withLayerCommands(ohne, ['-v', '--cwd', app]), ohne);
    strictEqual(await withLayerCommands(ohne, ['--cwd', app, 'seed']), ohne);
    await rejects(
      withLayerCommands(ohne, ['--version', '--help', '--cwd', app]),
      /The Lich King stirs/,
    );
    await rejects(withLayerCommands(ohne, ['--cwd', app]), /The Lich King stirs/);
  });

  it('returns `root` itself outside an ohne project', async () => {
    const dir = join(root, 'plain');
    write(join(dir, 'package.json'), JSON.stringify({ name: 'plain' }));
    command(dir, 'seed');

    strictEqual(await withLayerCommands(ohne, ['--help', '--cwd', dir]), ohne);
  });

  it('mounts the commands of every layer after the built-ins, sorted by name, for the root help', async () => {
    const app = join(root, 'help');
    const dep = join(app, 'packages', 'dep');
    writePackage(app, 'help', "export default { layers: ['dep'] };\n", ['dep']);
    writePackage(dep, 'dep', '');
    mkdirSync(join(app, 'node_modules'));
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    command(dep, 'zap');
    command(dep, 'backup');
    command(app, 'seed');

    const cli = await withLayerCommands(ohne, ['--help', '--cwd', app]);
    deepStrictEqual(Object.keys(cli.subCommands ?? {}), [...BUILTINS, 'backup', 'seed', 'zap']);
  });

  it('imports only the named command, so a broken sibling cannot fail it', async () => {
    const app = project('named');
    command(app, 'seed');
    write(join(app, 'commands', 'broken.ts'), 'export default {\n');

    const cli = await withLayerCommands(ohne, ['seed', '--cwd', app]);
    deepStrictEqual(Object.keys(cli.subCommands ?? {}), [...BUILTINS, 'seed']);
  });

  it('imports every command for a name none of them has', async () => {
    const app = project('unknown');
    command(app, 'seed');
    command(app, 'backup');

    const cli = await withLayerCommands(ohne, ['sede', '--cwd', app]);
    deepStrictEqual(Object.keys(cli.subCommands ?? {}), [...BUILTINS, 'backup', 'seed']);
  });

  it('skips a layer command named like a built-in, warning with its file', async () => {
    const app = project('clash');
    const file = command(app, 'sync');
    command(app, 'seed');

    const cli = await withLayerCommands(ohne, ['--help', '--cwd', app]);
    strictEqual(cli.subCommands?.sync, ohne.subCommands?.sync);
    deepStrictEqual(Object.keys(cli.subCommands ?? {}), [...BUILTINS, 'seed']);
    match(written, /Command sync is built in/);
    ok(written.includes(relative(process.cwd(), file)));
  });

  it('gives each runnable command `--cwd` on a copy, leaving the definition for the next mount', async () => {
    const app = project('mount');
    const seed = await imported(
      command(
        app,
        'seed',
        "{ meta: { name: 'seed' }, args: { count: { type: 'string' } }, run() {} }",
      ),
    );
    const db = await imported(
      command(
        app,
        'db',
        "{ meta: { name: 'db' }, subCommands: { reset: { meta: { name: 'reset' }, run() {} } } }",
      ),
    );
    const { run } = seed;

    const first = await withLayerCommands(ohne, ['--help', '--cwd', app]);
    const second = await withLayerCommands(ohne, ['--help', '--cwd', app]);
    for (const cli of [first, second]) {
      deepStrictEqual(Object.keys(cli.subCommands?.seed?.args ?? {}), ['count', 'cwd']);
      deepStrictEqual(Object.keys(cli.subCommands?.db?.subCommands?.reset?.args ?? {}), ['cwd']);
    }
    deepStrictEqual(Object.keys(seed.args ?? {}), ['count']);
    strictEqual(seed.run, run);
    strictEqual(db.subCommands?.reset?.args, undefined);
  });

  it('rejects a command that declares its own `cwd`, at any depth, naming its file', async () => {
    const app = project('own-cwd');
    const seed = command(
      app,
      'seed',
      "{ meta: { name: 'seed' }, args: { cwd: { type: 'string' } }, run() {} }",
    );
    const db = command(
      app,
      'db',
      "{ meta: { name: 'db' }, subCommands: { reset: { meta: { name: 'reset' }, args: { cwd: { type: 'string' } }, run() {} } } }",
    );

    await rejects(
      withLayerCommands(ohne, ['seed', '--cwd', app]),
      (error) =>
        isOhneError(error) &&
        error.title === 'Command `seed` declares `--cwd`' &&
        error.path === seed,
    );
    await rejects(
      withLayerCommands(ohne, ['db', '--cwd', app]),
      (error) =>
        isOhneError(error) &&
        error.title === 'Command `reset` declares `--cwd`' &&
        error.path === db,
    );
  });

  it('discovers and runs the commands of the `--cwd` project, not the working directory', async () => {
    const here = project('here');
    command(here, 'alpha');
    const there = project('there');
    mkdirSync(join(there, 'node_modules'));
    symlinkSync(FRAMEWORK, join(there, 'node_modules', 'ohnejs'), 'dir');
    command(
      there,
      'bravo',
      "{ meta: { name: 'bravo' }, run() { globalThis.__ohneCommandRan = true; } }",
    );

    process.chdir(here);
    try {
      const cli = await withLayerCommands(ohne, ['--help', '--cwd', there]);
      deepStrictEqual(Object.keys(cli.subCommands ?? {}), [...BUILTINS, 'bravo']);
      strictEqual(await runCommand(cli, ['bravo', '--cwd', there]), 0);
    } finally {
      process.chdir(cwd);
    }
    strictEqual(scope.__ohneCommandRan, true);
    strictEqual(existsSync(join(there, '.ohne')), true);
    strictEqual(existsSync(join(here, '.ohne')), false);
    throws(() => useDatabase(), /The database is not connected/);
  });

  it('warns before running a command on a database its schema is not synced to', async () => {
    const app = project('unsynced');
    mkdirSync(join(app, 'node_modules'));
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohnejs'), 'dir');
    write(
      join(app, 'collections', 'Posts.ts'),
      "import { defineCollection, field } from 'ohnejs';\n" +
        "export default defineCollection({ fields: { title: field('text') } });\n",
    );
    command(
      app,
      'seed',
      "{ meta: { name: 'seed' }, run() { globalThis.__ohneCommandRan = true; } }",
    );

    const cli = await withLayerCommands(ohne, ['seed', '--cwd', app]);
    scope.__ohneCommandRan = false;
    strictEqual(await runCommand(cli, ['seed', '--cwd', app]), 0);
    strictEqual(scope.__ohneCommandRan, true);
    match(written, /Database not synced/);
  });

  it('throws `Not an ohne project` for a command name outside a project, unless it is a built-in typo', async () => {
    const dir = join(root, 'outside');
    mkdirSync(dir);

    await rejects(
      withLayerCommands(ohne, ['seed', '--cwd', dir]),
      (error) => isOhneError(error) && error.title === 'Not an ohne project' && error.path === dir,
    );
    strictEqual(await withLayerCommands(ohne, ['sycn', '--cwd', dir]), ohne);
  });

  it('rejects a command taking a flag ohne reads itself, by name or by alias', async () => {
    const app = project('reserved');
    command(
      app,
      'seed',
      "{ meta: { name: 'seed' }, args: { database: { type: 'string' } }, run() {} }",
    );
    command(
      app,
      'purge',
      "{ meta: { name: 'purge' }, args: { dir: { type: 'string', alias: 'cwd' } }, run() {} }",
    );

    await rejects(
      withLayerCommands(ohne, ['seed', '--cwd', app]),
      (error) => isOhneError(error) && error.title === 'Command `seed` declares `--database`',
    );
    await rejects(
      withLayerCommands(ohne, ['purge', '--cwd', app]),
      (error) => isOhneError(error) && error.title === 'Command `purge` declares `--cwd`',
    );
  });

  it('warns about a built-in clash when listing, never while running another command', async () => {
    const app = project('quiet');
    command(app, 'sync');
    command(app, 'seed');

    await withLayerCommands(ohne, ['seed', '--cwd', app]);
    doesNotMatch(written, /is built in/);
    await withLayerCommands(ohne, ['--help', '--cwd', app]);
    match(written, /Command sync is built in/);
  });
});
