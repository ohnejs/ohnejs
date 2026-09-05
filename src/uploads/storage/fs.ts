import { createReadStream } from 'node:fs';
import { cp, open, rename, rmdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, isNull, resolvePath, safeResolve, uuidv7 } from 'ohne/utils';
import { ensureDir, exists, removeDir, removeFile, stat } from 'ohne/utils/fs';

import type { StorageAdapter } from './adapter.ts';

import { ohneError } from '../../ohne/error/ohne-error.ts';

/**
 * Builds the `fs` storage backend, which keeps every object as a file under `root`.
 * `root` is the configured `uploads.url`, resolved against the working directory.
 * A key maps onto its path beneath `root`, so a folder prefix is a real directory.
 * A write lands in a sibling temp file and renames into place, so a reader never sees a partial object.
 * A delete also removes the parent directories it leaves empty, so the tree never accumulates them.
 *
 * @example
 * ```ts
 * useStorages().register('fs', (url) => createFSStorage(url))
 * ```
 */
export function createFSStorage(root: string): StorageAdapter {
  const base = resolvePath(root);

  return {
    async write(path, body) {
      const target = locate(base, path);
      const temp = `${target}.${uuidv7()}.tmp`;
      const handle = await inDir(dirname(target), () => open(temp, 'wx'));
      try {
        await pipeline(Readable.fromWeb(body), handle.createWriteStream());
        await rename(temp, target);
      } catch (error) {
        await removeFile(temp).catch(() => {});
        throw error;
      }
    },

    async read(path, range) {
      const target = locate(base, path);
      const size = await fileSize(target);
      if (isNull(size)) return null;
      const stream = createReadStream(target, { start: range?.start, end: range?.end });
      return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size };
    },

    async stat(path) {
      const size = await fileSize(locate(base, path));
      return isNull(size) ? null : { size };
    },

    async move(from, to) {
      const source = locate(base, from);
      const target = locate(base, to);
      if (!(await exists(source))) return;
      await inDir(dirname(target), () => relocate(source, target));
    },

    async delete(path) {
      const target = locate(base, path);
      await removeDir(target);
      await pruneEmpty(dirname(target), base);
    },
  };
}

/**
 * Maps a storage key onto its absolute path beneath `base`.
 * Throws when the key would escape `base`, the one filesystem boundary the layer has.
 */
function locate(base: string, path: string): string {
  const resolved = safeResolve(base, path);
  if (isNull(resolved)) throw ohneError(`Storage path \`${path}\` escapes the uploads root`);
  return resolved;
}

/**
 * Creates `dir`, then runs `action`, which places something inside it.
 * A concurrent `delete` may prune `dir` between the two, failing the action with `ENOENT`.
 * That one failure creates `dir` again and runs the action once more.
 */
async function inDir<T>(dir: string, action: () => Promise<T>): Promise<T> {
  await ensureDir(dir);
  try {
    return await action();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await ensureDir(dir);
    return action();
  }
}

/**
 * The size of the file at `target`, or `null` when nothing or a directory is there.
 */
async function fileSize(target: string): Promise<number | null> {
  const info = await stat(target);
  return isNull(info) || !info.isFile() ? null : info.size;
}

/**
 * Renames `source` to `target`, copying and removing instead when the two sit on different filesystems.
 */
async function relocate(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(source, target, { recursive: true });
    await removeDir(source);
  }
}

/**
 * Removes `dir` when it is empty, then each parent the removal leaves empty, stopping short of `root`.
 * A directory that is missing or still holds something ends the walk.
 */
async function pruneEmpty(dir: string, root: string): Promise<void> {
  for (let current = dir; current !== root; current = dirname(current)) {
    try {
      await rmdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'ENOENT') return;
      throw error;
    }
  }
}
