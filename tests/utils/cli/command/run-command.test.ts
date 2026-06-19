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

  it('prints version for --version and -v and exits 0', async () => {
    const cli = defineCommand({ meta: { name: 'app', version: '2.0.0' }, run() {} });
    for (const flag of ['--version', '-v']) {
      const { out, options } = capture();
      strictEqual(await runCommand(cli, [flag], options), 0);
      deepStrictEqual(out, ['app 2.0.0\n']);
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
});
