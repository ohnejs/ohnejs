import { listDir, readFile, removeFile } from '../../utils/fs/index.ts';
import { isNull } from '../../utils/index.ts';
import { BANNER_PREFIX, codegenDir } from './codegen-dir.ts';

/**
 * Deletes every stale generated file under the app's codegen directory.
 * `keep` is the complete output set of a full codegen, as absolute paths.
 * A file is removed only when it is not in `keep` and carries the ohne banner, whatever version wrote it.
 * A file without the banner is never touched, so a misconfigured `dirs.codegen` cannot destroy your work.
 * Hidden entries and directories are left in place.
 * Returns the absolute paths removed, empty when there is no codegen directory.
 *
 * Call it only after a full codegen; a partial regen does not know the complete set.
 */
export async function pruneCodegen(from: string, keep: readonly string[]): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];

  const entries = await listDir(dir);
  if (isNull(entries)) return [];

  const kept = new Set(keep);
  const removed: string[] = [];
  for (const entry of entries) {
    if (kept.has(entry.path)) continue;
    if (!(await generated(entry.path))) continue;
    await removeFile(entry.path);
    removed.push(entry.path);
  }
  return removed;
}

/**
 * Whether the file at `path` starts with `BANNER_PREFIX`; a missing file counts as not generated.
 */
async function generated(path: string): Promise<boolean> {
  const content = await readFile(path);
  return !isNull(content) && content.startsWith(BANNER_PREFIX);
}
