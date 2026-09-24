import type { Command } from '../../utils/cli/index.ts';
import type { ScannedCommand } from './scan-layer-commands.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isPlainObject, isString } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Imports one scanned command's definition.
 *
 * The file must default-export a `defineCommand` result, or this throws.
 * Its `meta.name` must be the command's name.
 *
 * @example
 * ```ts
 * await importCommand({ name: 'seed', file: '/app/commands/seed.ts' })
 * // -> { meta: { name: 'seed', description: 'Seed the database.' }, run: [Function: run] }
 * ```
 */
export async function importCommand(scanned: ScannedCommand): Promise<Command> {
  const command = await importDefault<Command>(scanned.file);
  if (!isPlainObject(command) || !isPlainObject(command.meta) || !isString(command.meta.name)) {
    throw ohneError({
      title: `Command \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineCommand(...)` result from the file.'],
      path: scanned.file,
    });
  }
  if (command.meta.name !== scanned.name) {
    throw ohneError({
      title: `Command \`${scanned.name}\` is named \`${command.meta.name}\``,
      body: [
        'A command is named by its file, so its `meta.name` must match.',
        `Set \`meta.name\` to \`${scanned.name}\`, or rename the file.`,
      ],
      path: scanned.file,
    });
  }
  return command;
}
