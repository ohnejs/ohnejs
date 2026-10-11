import { listDir, readFile } from '../../utils/fs/index.ts';
import { isNull, naturalCompare } from '../../utils/index.ts';
import { isOhneProject } from '../project/is-ohne-project.ts';
import { assertImportablePath } from './assert-importable-path.ts';

/**
 * A module a layer augments with `declare module`: the server's `ohnejs` or the browser's `ohnejs/dashboard`.
 */
export type AugmentedModule = 'ohnejs' | 'ohnejs/dashboard';

/**
 * Finds the `.ts` files under `dir` that augment `module`, `ohnejs` unless given.
 *
 * Reads every `.ts` file in the directory, skipping its own `node_modules` and hidden dirs like `.ohne`.
 * A nested directory with an `ohne.config.ts` of its own is a separate layer, so it is skipped too.
 * A file counts when its text contains the ambient augmentation marker, like `declare module 'ohnejs'`.
 * The marker matches the quoted name whole, so an `ohnejs/dashboard` augmentation never counts for `ohnejs`.
 * The generators import the matches so their augmentations reach a consuming app's type program.
 * A match whose path holds `%`, `#`, or `?` throws, since its generated import specifier cannot resolve.
 *
 * Returns the absolute paths, sorted by path so the generated imports stay stable across runs.
 *
 * @example
 * ```ts
 * await scanLayerAugmentations('/layers/auth')
 * // -> ['/layers/auth/hooks.ts']
 *
 * await scanLayerAugmentations('/layers/auth/dashboard', 'ohnejs/dashboard')
 * // -> ['/layers/auth/dashboard/meta.ts']
 * ```
 */
export async function scanLayerAugmentations(
  dir: string,
  module: AugmentedModule = 'ohnejs',
): Promise<string[]> {
  const entries = await listDir(dir, {
    ext: 'ts',
    descend: async (entry) => entry.name !== 'node_modules' && !(await isOhneProject(entry.path)),
  });
  if (isNull(entries)) return [];
  entries.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  const marker = `declare module '${module}'`;
  const files: string[] = [];
  for (const entry of entries) {
    const content = await readFile(entry.path);
    if (isNull(content) || !content.includes(marker)) continue;
    assertImportablePath('augmentation', entry.relativePath, entry.path);
    files.push(entry.path);
  }
  return files;
}
