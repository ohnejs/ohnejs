import { listDir, readFile } from '../../utils/fs/index.ts';
import { isNull, naturalCompare } from '../../utils/index.ts';
import { isOhneProject } from '../project/is-ohne-project.ts';
import { assertImportablePath } from './assert-importable-path.ts';

const MARKER = "declare module 'ohnejs'";

/**
 * Finds the `.ts` files under `dir` that augment the `ohnejs` module.
 *
 * Reads every `.ts` file in the layer, skipping its own `node_modules` and hidden dirs like `.ohne`.
 * A nested directory with an `ohne.config.ts` of its own is a separate layer, so it is skipped too.
 * A file counts when its text contains `declare module 'ohnejs'`, the ambient augmentation marker.
 * `generateLayerName` imports the matches so their augmentations reach a consuming app's type program.
 * A match whose path holds `%`, `#`, or `?` throws, since its generated import specifier cannot resolve.
 *
 * Returns the absolute paths, sorted by path so the generated imports stay stable across runs.
 *
 * @example
 * ```ts
 * await scanLayerAugmentations('/layers/auth') // -> ['/layers/auth/hooks.ts']
 * ```
 */
export async function scanLayerAugmentations(dir: string): Promise<string[]> {
  const entries = await listDir(dir, {
    ext: 'ts',
    descend: async (entry) => entry.name !== 'node_modules' && !(await isOhneProject(entry.path)),
  });
  if (isNull(entries)) return [];
  entries.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  const files: string[] = [];
  for (const entry of entries) {
    const content = await readFile(entry.path);
    if (isNull(content) || !content.includes(MARKER)) continue;
    assertImportablePath('augmentation', entry.relativePath, entry.path);
    files.push(entry.path);
  }
  return files;
}
