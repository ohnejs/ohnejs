import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pickANSIColors } from '../../../../src/utils/ansi/index.ts';
import { renderHelp } from '../../../../src/utils/cli/index.ts';

const plain = pickANSIColors(false);

describe('renderHelp', () => {
  it('renders a leaf command with options', () => {
    const build = {
      meta: { name: 'build', description: 'Build it' },
      args: {
        out: { type: 'string', default: 'dist', alias: 'o' },
        minify: { type: 'boolean' },
      },
    } as const;
    strictEqual(
      renderHelp(build, plain),
      'build\n' +
        '\n' +
        'Build it\n' +
        '\n' +
        'USAGE\n' +
        '  build [options]\n' +
        '\n' +
        'OPTIONS\n' +
        '  --out, -o <string>  (default: dist)\n' +
        '  --minify\n' +
        '  --help, -h          Show help\n',
    );
  });

  it('renders a group with a command list and version', () => {
    const cli = {
      meta: { name: 'app', version: '1.2.0', description: 'Demo CLI' },
      subCommands: { build: { meta: { name: 'build', description: 'Build it' } } },
    } as const;
    strictEqual(
      renderHelp(cli, plain),
      'app 1.2.0\n' +
        '\n' +
        'Demo CLI\n' +
        '\n' +
        'USAGE\n' +
        '  app <command> [options]\n' +
        '\n' +
        'COMMANDS\n' +
        '  build  Build it\n' +
        '\n' +
        'OPTIONS\n' +
        '  --version, -v  Show version\n' +
        '  --help, -h     Show help\n',
    );
  });

  it('tints the title, headers, and flags when colored', () => {
    const cli = {
      meta: { name: 'app', version: '1.2.0' },
      subCommands: { build: { meta: { name: 'build', description: 'Build it' } } },
    } as const;
    strictEqual(
      renderHelp(cli, pickANSIColors(true)),
      '\x1b[1mapp\x1b[22m \x1b[2m1.2.0\x1b[22m\n' +
        '\n' +
        '\x1b[1mUSAGE\x1b[22m\n' +
        '  app <command> [options]\n' +
        '\n' +
        '\x1b[1mCOMMANDS\x1b[22m\n' +
        '  \x1b[96mbuild\x1b[39m  Build it\n' +
        '\n' +
        '\x1b[1mOPTIONS\x1b[22m\n' +
        '  \x1b[96m--version, -v\x1b[39m  Show version\n' +
        '  \x1b[96m--help, -h\x1b[39m     Show help\n',
    );
  });

  it('omits a hidden option from the option list', () => {
    const build = {
      meta: { name: 'build' },
      args: {
        out: { type: 'string' },
        secret: { type: 'string', hidden: true },
      },
    } as const;
    const help = renderHelp(build, plain);
    strictEqual(help.includes('--out'), true);
    strictEqual(help.includes('--secret'), false);
  });

  it('renders a GLOBAL OPTIONS section when globals are passed', () => {
    const build = { meta: { name: 'build' }, args: { out: { type: 'string' } } } as const;
    const globals = {
      forceSync: { type: 'boolean', description: 'Sets FORCE_SYNC' },
      host: { type: 'string', description: 'Sets HOST' },
    } as const;
    const help = renderHelp(build, plain, globals);
    strictEqual(help.includes('GLOBAL OPTIONS'), true);
    strictEqual(help.includes('--force-sync'), true);
    strictEqual(help.includes('--host <string>'), true);
    strictEqual(help.includes('Sets HOST'), true);
  });

  it('omits the GLOBAL OPTIONS section when globals are absent', () => {
    const build = { meta: { name: 'build' }, args: { out: { type: 'string' } } } as const;
    strictEqual(renderHelp(build, plain).includes('GLOBAL OPTIONS'), false);
  });
});
