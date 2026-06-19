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
});
