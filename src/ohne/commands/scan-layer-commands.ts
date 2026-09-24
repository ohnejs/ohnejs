import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isEmpty,
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToKebabName,
  relativePath,
} from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * One command file found in a layer, before its definition is imported.
 */
export interface ScannedCommand {
  /**
   * The command name, derived from the file name via `pathToKebabName`.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads the command files at the top level of one layer's commands directory.
 *
 * Each top-level `.ts` file under `<layer.dir>/<commands>` is one command, named via `pathToKebabName`.
 * A `_`-prefixed file is a helper and is skipped.
 * A file that derives no name, like `index.ts`, throws.
 * Two files resolving to the same name collide and throw, naming both.
 * Results sort by file name; returns `[]` when the layer has no commands directory.
 *
 * @example
 * ```ts
 * await scanLayerCommands({ name: 'app', dir: '/app' }, 'commands')
 * // -> [{ name: 'seed', file: '/app/commands/seed.ts' }]
 * ```
 */
export async function scanLayerCommands(
  layer: OhneLayer,
  commands: string,
): Promise<ScannedCommand[]> {
  const entries = await listDir(joinPath(layer.dir, commands), {
    ext: 'ts',
    files: true,
    depth: 0,
  });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .filter((entry) => !entry.name.startsWith('_'))
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((entry) => {
      assertImportablePath('command', entry.name, entry.path);
      const name = pathToKebabName(entry.name);
      if (isEmpty(name)) {
        throw ohneError({
          title: `\`${entry.name}\` names no command`,
          body: [
            'A command is named by its file, and this file name derives none.',
            'Name the file after the command, like `seed.ts`.',
          ],
          path: entry.path,
        });
      }
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate command \`${name}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same name.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(name, entry.path);
      return { name, file: entry.path };
    });
}
