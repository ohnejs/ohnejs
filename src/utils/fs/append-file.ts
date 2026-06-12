import { appendFile as fsAppendFile } from 'node:fs/promises';

import { dirname } from '../path/dirname.ts';
import { ensureDir } from './ensure-dir.ts';

/**
 * Appends `content` to `path` using `O_APPEND`.
 *
 * POSIX guarantees `O_APPEND` writes are atomic against concurrent writers up to `PIPE_BUF` bytes.
 * `PIPE_BUF` is 4096 on Linux and 512 on macOS.
 * Writes larger than `PIPE_BUF` may interleave with other concurrent writers.
 *
 * Creates the file if missing.
 * Creates parent directories on first write only, so the per-call cost is a single `O_APPEND` write.
 *
 * @example
 * ```ts
 * await appendFile('./app.log', `${line}\n`)
 * ```
 */
export async function appendFile(path: string, content: string): Promise<void> {
  try {
    await fsAppendFile(path, content, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await ensureDir(dirname(path));
    await fsAppendFile(path, content, 'utf8');
  }
}
