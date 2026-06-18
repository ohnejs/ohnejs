import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { renderHelp } from '../../../../src/utils/cli/index.ts';

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
      renderHelp(build),
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
      renderHelp(cli),
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
        '  --version   Show version\n' +
        '  --help, -h  Show help\n',
    );
  });
});
