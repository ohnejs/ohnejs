import { randomBytes } from 'node:crypto';
import { rename, unlink, writeFile as fsWriteFile } from 'node:fs/promises';

import { dirname } from '../path/dirname.ts';
import { ensureDir } from './ensure-dir.ts';

/**
 * Writes `content` to `path` atomically.
 * A string is written as UTF-8, bytes as they are.
 *
 * Writes to a sibling temp file first, then renames into place.
 * `rename` is atomic on POSIX, so the destination is either the previous contents or the full new contents.
 * Never half-written, even on crash.
 *
 * The parent directory is created if missing.
 *
 * @example
 * ```ts
 * await writeFile('./build/manifest.txt', 'hello')
 * await writeFile('./build/logo.png', bytes)
 * ```
 */
export async function writeFile(path: string, content: string | Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fsWriteFile(tmp, content, 'utf8');
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
