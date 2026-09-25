import { createReadStream } from 'node:fs';
import { cp, open, readdir, rename, rmdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { appRoot } from 'ohnejs';
import {
  basename,
  dirname,
  isNull,
  joinPath,
  resolvePath,
  safeResolve,
  uuidv7,
} from 'ohnejs/utils';
import { truncateWithHash } from 'ohnejs/utils/crypto';
import { ensureDir, exists, listDir, removeDir, removeFile, stat } from 'ohnejs/utils/fs';

import type { StorageAdapter } from './adapter.ts';

import { ohneError } from '../../ohne/error/ohne-error.ts';

const WRITE_TEMP = /^\.(.+)\.[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.tmp$/;

const REPLACEABLE = new Set(['EXDEV', 'ENOTEMPTY', 'EEXIST', 'EISDIR', 'ENOTDIR']);

/**
 * Builds the `fs` storage backend, which keeps every object as a file under `root`.
 * `root` is the configured `uploads.url`, resolved against the app root.
 * A key maps onto its path beneath `root`, so a folder prefix is a real directory.
 * A write lands in a sibling temp file and renames into place, so a reader never sees a partial object.
 * The temp's name starts with a dot, which no upload name does, so it is never taken for a stored object.
 * A delete also removes the temp files a crashed write left beside the object.
 * It removes the parent directories it leaves empty too, so the tree never accumulates them.
 * A listing walks the tree and passes over those temp files.
 *
 * @example
 * ```ts
 * useStorages().register('fs', (url) => createFSStorage(url))
 * ```
 */
export function createFSStorage(root: string): StorageAdapter {
  const base = resolvePath(root, appRoot());

  return {
    async write(path, body) {
      const target = locate(base, path);
      const dir = dirname(target);
      const temp = joinPath(dir, `.${tempStem(target)}.${uuidv7()}.tmp`);
      const handle = await inDir(dir, () => open(temp, 'wx'));
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

    async *list(prefix = '') {
      const target = locate(base, prefix);
      if (!isNull(await fileSize(target))) {
        yield prefix;
        return;
      }
      for (const entry of (await listDir(target, { hidden: true })) ?? []) {
        if (WRITE_TEMP.test(entry.name)) continue;
        yield prefix === '' ? entry.relativePath : `${prefix}/${entry.relativePath}`;
      }
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
      await removeWriteTemps(target);
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
 * Renames `source` to `target`, replacing whatever a stray or an interrupted copy left there.
 * Across filesystems it copies and removes instead.
 */
async function relocate(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!REPLACEABLE.has(code)) throw error;
    await removeDir(target);
    if (code !== 'EXDEV') return rename(source, target);
    await cp(source, target, { recursive: true });
    await removeDir(source);
  }
}

/**
 * Removes every temp file a write of `target` left beside it, so a crash mid-write leaks nothing.
 */
async function removeWriteTemps(target: string): Promise<void> {
  const dir = dirname(target);
  const stem = tempStem(target);
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (entry.isFile() && WRITE_TEMP.exec(entry.name)?.[1] === stem) {
      await removeFile(joinPath(dir, entry.name));
    }
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

/**
 * The name of `target` as its write temps carry it.
 * A slug past 213 characters is cut with a hash of the whole, so the temp still fits a 255-byte file name.
 */
function tempStem(target: string): string {
  return truncateWithHash(basename(target), 213);
}
