import { readFile } from './read-file.ts';
import { writeFile } from './write-file.ts';

/**
 * Writes `content` to `path` only if it differs from what is already there.
 *
 * Reads the current file first and compares byte for byte.
 * If the contents match, the write is skipped and the file's mtime is left untouched.
 * This keeps file watchers and HMR from firing on output that did not actually change.
 *
 * Returns `true` if a write happened, `false` if the file was already up to date.
 * Writes atomically and creates parent directories, like `writeFile`.
 *
 * @example
 * ```ts
 * await writeFileIfChanged('./.ohne/imports.ts', source) // -> true  (first run)
 * await writeFileIfChanged('./.ohne/imports.ts', source) // -> false (unchanged)
 * ```
 */
export async function writeFileIfChanged(path: string, content: string): Promise<boolean> {
  const current = await readFile(path);
  if (current === content) return false;
  await writeFile(path, content);
  return true;
}
