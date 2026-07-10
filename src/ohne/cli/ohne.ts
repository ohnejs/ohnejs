import { defineCommand } from '../../utils/cli/index.ts';
import { version } from '../meta/version.ts';
import { devCommand } from './commands/dev.ts';
import { initCommand } from './commands/init.ts';
import { prepareCommand } from './commands/prepare.ts';
import { serveCommand } from './commands/serve.ts';
import { syncCommand } from './commands/sync.ts';

/**
 * The root `ohne` command.
 * Dispatches to a subcommand by the first positional and carries the shared `--version` and `--help`.
 */
export const ohne = defineCommand({
  meta: {
    name: 'ohne',
    version,
    description: 'A zero-dependency TypeScript framework for the web.',
  },
  subCommands: {
    dev: devCommand,
    init: initCommand,
    prepare: prepareCommand,
    serve: serveCommand,
    sync: syncCommand,
  },
});
