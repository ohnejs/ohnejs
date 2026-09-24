import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineCommand, runCommand } from '../../../../src/utils/cli/index.ts';
import { sleep } from '../../../../src/utils/index.ts';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const options = {
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
  };
  return { out, err, options };
}

describe('runCommand', () => {
  it('dispatches to a subcommand with the resolved context', async () => {
    let ctx: unknown;
    const build = defineCommand({
      meta: { name: 'build' },
      args: { out: { type: 'string', default: 'dist' } },
      run(c) {
        ctx = c;
      },
    });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const { options } = capture();
    strictEqual(await runCommand(cli, ['build', 'x', '--out', 'public'], options), 0);
    deepStrictEqual(ctx, { values: { out: 'public' }, positionals: ['x'] });
  });

  it('prints the bare version for --version and -v and exits 0', async () => {
    const cli = defineCommand({ meta: { name: 'app', version: '2.0.0' }, run() {} });
    for (const flag of ['--version', '-v']) {
      const { out, options } = capture();
      strictEqual(await runCommand(cli, [flag], options), 0);
      deepStrictEqual(out, ['2.0.0\n']);
    }
  });

  it('prints help for --help and exits 0', async () => {
    const cli = defineCommand({ meta: { name: 'app' }, run() {} });
    const { out, options } = capture();
    strictEqual(await runCommand(cli, ['--help'], options), 0);
    strictEqual(out.length, 1);
    strictEqual(out[0].startsWith('app\n'), true);
  });

  it('forces color on and off independent of the stream', async () => {
    const cli = defineCommand({ meta: { name: 'app' }, run() {} });

    const on = capture();
    strictEqual(await runCommand(cli, ['--help'], { ...on.options, color: true }), 0);
    strictEqual(on.out[0].includes('\x1b['), true);

    const off: string[] = [];
    const tty = { stdout: { write: (s: string) => off.push(s), isTTY: true } };
    strictEqual(await runCommand(cli, ['--help'], { ...tty, color: false }), 0);
    strictEqual(off[0].includes('\x1b['), false);
  });

  it('shows help for a group invoked with no command', async () => {
    const child = defineCommand({ meta: { name: 'child', description: 'A child' }, run() {} });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { child } });
    const { out, options } = capture();
    strictEqual(await runCommand(cli, [], options), 0);
    strictEqual(out[0].includes('COMMANDS'), true);
  });

  it('reports an unknown command with a suggestion and exits 1', async () => {
    const build = defineCommand({ meta: { name: 'build' }, run() {} });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const { err, options } = capture();
    strictEqual(await runCommand(cli, ['biuld'], options), 1);
    deepStrictEqual(err, ['Unknown command `biuld`. Did you mean `build`?\n']);
  });

  it('reports a flag in place of the command and exits 1', async () => {
    const build = defineCommand({ meta: { name: 'build' }, run() {} });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const { out, err, options } = capture();
    strictEqual(await runCommand(cli, ['--cwd', 'x', 'build'], options), 1);
    deepStrictEqual(out, []);
    deepStrictEqual(err, ['Missing command before `--cwd`\n']);
  });

  it('prints the group help for flags with no command after them', async () => {
    const build = defineCommand({ meta: { name: 'build' }, run() {} });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const { out, err, options } = capture();
    strictEqual(await runCommand(cli, ['--cwd', 'x'], options), 0);
    strictEqual(out[0]!.includes('\n  app <command> [options]\n'), true);
    deepStrictEqual(err, []);
  });

  it('reports an arg error and exits 1', async () => {
    const cli = defineCommand({
      meta: { name: 'app' },
      args: { name: { type: 'string', required: true } },
      run() {},
    });
    const { err, options } = capture();
    strictEqual(await runCommand(cli, [], options), 1);
    strictEqual(err[0], 'Missing required flag `--name`\n');
  });

  it('names the whole command path in the usage line and the hint', async () => {
    const seed = defineCommand({
      meta: { name: 'seed' },
      args: { count: { type: 'number', required: true } },
      run() {},
    });
    const cli = defineCommand({
      meta: { name: 'app' },
      subCommands: { db: defineCommand({ meta: { name: 'db' }, subCommands: { seed } }) },
    });

    const failed = capture();
    strictEqual(await runCommand(cli, ['db', 'seed'], failed.options), 1);
    strictEqual(failed.err.at(-1), '\nRun `app db seed --help` for usage.\n');

    const help = capture();
    await runCommand(cli, ['db', 'seed', '--help'], help.options);
    strictEqual(help.out[0]!.includes('\n  app db seed [options]\n'), true);
  });

  it('awaits an async run handler', async () => {
    let done = false;
    const cli = defineCommand({
      meta: { name: 'app' },
      async run() {
        await sleep(0);
        done = true;
      },
    });
    await runCommand(cli, [], { stdout: { write() {} }, stderr: { write() {} } });
    strictEqual(done, true);
  });

  it('accepts a global flag on a subcommand without reporting it unknown', async () => {
    let ran = false;
    const build = defineCommand({
      meta: { name: 'build' },
      args: { out: { type: 'string' } },
      run() {
        ran = true;
      },
    });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const globals = { host: { type: 'string' } } as const;
    const { err, options } = capture();
    strictEqual(await runCommand(cli, ['build', '--host', '0.0.0.0'], { ...options, globals }), 0);
    strictEqual(ran, true);
    deepStrictEqual(err, []);
  });

  it('lists globals in the root help but not in a subcommand help', async () => {
    const build = defineCommand({ meta: { name: 'build' }, run() {} });
    const cli = defineCommand({ meta: { name: 'app' }, subCommands: { build } });
    const globals = { host: { type: 'string' } } as const;

    const root = capture();
    await runCommand(cli, ['--help'], { ...root.options, globals });
    strictEqual(root.out[0]!.includes('GLOBAL OPTIONS'), true);

    const subHelp = capture();
    await runCommand(cli, ['build', '--help'], { ...subHelp.options, globals });
    strictEqual(subHelp.out[0]!.includes('GLOBAL OPTIONS'), false);
  });
});
