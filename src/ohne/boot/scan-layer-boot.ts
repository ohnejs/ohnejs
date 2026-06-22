import { listDir } from '../../utils/fs/index.ts';
import { isNull, isUndefined, joinPath, naturalCompare } from '../../utils/index.ts';

/**
 * Lists the boot files to run for one layer, in execution order.
 *
 * Reads the top level of `<dir>/<boot>` only - nested files are ignored.
 * If an `index.ts` sits at the top, it is the only file returned.
 * A layer can then order its own boot logic by importing from there.
 * Otherwise every top-level `.ts` file is returned, name-sorted.
 * Returns `[]` when the layer has no boot directory.
 *
 * @example
 * ```ts
 * await scanLayerBoot('/app', 'boot')
 * // -> ['/app/boot/00-env.ts', '/app/boot/10-hooks.ts']
 *
 * await scanLayerBoot('/app', 'boot')
 * // -> ['/app/boot/index.ts'] when an index is present
 * ```
 */
export async function scanLayerBoot(dir: string, boot: string): Promise<string[]> {
  const entries = await listDir(joinPath(dir, boot), { ext: 'ts', files: true, depth: 0 });
  if (isNull(entries)) return [];

  const index = entries.find((entry) => entry.name === 'index.ts');
  if (!isUndefined(index)) return [index.path];

  return entries.sort((a, b) => naturalCompare(a.name, b.name)).map((entry) => entry.path);
}
