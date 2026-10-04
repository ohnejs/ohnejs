// Brings the root into the program, which the `declare module 'ohnejs'` augmentations merge into.
import type {} from '../index.ts';

import { runCommand } from '../../utils/cli/index.ts';
import { launcherName } from '../../utils/index.ts';
import { colorOverride } from '../env/color-override.ts';
import { applyEnvFlags, envGlobals } from '../env/env-flags.ts';
import { reportError } from '../error/report-error.ts';
import { version } from '../meta/version.ts';
import { initCommand } from './commands/init.ts';

const ENV_FLAGS = ['NO_COLOR', 'FORCE_COLOR', 'SILENT', 'DEBUG'] as const;

const command = {
  ...initCommand,
  meta: {
    name: 'create-ohne',
    version,
    description: 'Scaffold a new ohne project. The one argument is its directory.',
  },
};

/**
 * Runs the `init` scaffold as `create-ohne`, the entry `npm create ohne` reaches.
 * Applies only the color, silent, and debug env flags, reports a failure, and sets the exit code.
 *
 * pnpm, yarn, and bun pass a literal `--` through, so their first standalone `--` is dropped.
 * npm consumes its own, so under npm `argv` runs as given.
 *
 * @example
 * ```ts
 * await create(process.argv.slice(2))
 * ```
 */
export async function create(argv: string[]): Promise<void> {
  process.on('unhandledRejection', (error) => {
    reportError(error);
    process.exitCode = 1;
  });

  const separator = argv.indexOf('--');
  const npm = launcherName(process.env.npm_config_user_agent) === 'npm';
  const args = npm || separator === -1 ? argv : argv.toSpliced(separator, 1);

  try {
    applyEnvFlags(args, ENV_FLAGS);
    const globals = envGlobals(ENV_FLAGS);
    const code = await runCommand(command, args, { color: colorOverride(), globals });
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}
