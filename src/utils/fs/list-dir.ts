import type { Dir } from 'node:fs';

import { opendir, stat } from 'node:fs/promises';

import { isArray } from '../is/is-array.ts';
import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { childPath } from '../path/child-path.ts';
import { extname } from '../path/extname.ts';
import { resolvePath } from '../path/resolve-path.ts';

/**
 * A single entry returned by `listDir`.
 */
export interface DirEntry {
  /**
   * Absolute, normalized path to the entry.
   */
  path: string;

  /**
   * Path of the entry relative to the listed root, normalized.
   */
  relativePath: string;

  /**
   * Base name including the extension (e.g. `'foo.ts'`).
   */
  name: string;

  /**
   * Base name without the extension (e.g. `'foo'`).
   */
  stem: string;

  /**
   * Extension including the leading dot (e.g. `'.ts'`).
   * Empty string for files with no extension.
   */
  ext: string;

  /**
   * Entry type.
   */
  type: 'file' | 'directory';
}

/**
 * Options for `listDir`.
 */
export interface ListDirOptions {
  /**
   * Recursion depth.
   * `0` lists only the root's immediate contents, `1` descends one level, etc.
   *
   * @default
   * Infinity
   */
  depth?: number;

  /**
   * Include file entries in the result.
   *
   * @default
   * true
   */
  files?: boolean;

  /**
   * Include directory entries in the result.
   * Independent of recursion: subdirectories are still descended into when `depth` and `descend` allow.
   *
   * @default
   * false
   */
  dirs?: boolean;

  /**
   * Restrict file entries to these extensions.
   * Each value may be written with or without a leading dot (`'ts'` and `'.ts'` are equivalent).
   * Has no effect on directory entries.
   * Omitted lists files of every extension.
   */
  ext?: string | string[];

  /**
   * Predicate applied after the built-in filters.
   * Return `true` to keep the entry.
   * Omitted keeps every entry.
   */
  filter?: (entry: DirEntry) => boolean;

  /**
   * Predicate deciding whether the walk enters a subdirectory.
   * Return `false` to skip it and everything below it, never opening it.
   * Omitted enters every subdirectory `depth` allows.
   */
  descend?: (entry: DirEntry) => boolean | Promise<boolean>;

  /**
   * Include entries whose name starts with `.`.
   *
   * @default
   * false
   */
  hidden?: boolean;

  /**
   * Follow symlinks during traversal.
   * When `false`, symlinks are skipped entirely.
   *
   * @default
   * false
   */
  followSymlinks?: boolean;
}

/**
 * Lists entries under a directory.
 *
 * `path` is resolved against `process.cwd()` if relative.
 * Returns `null` if the root directory does not exist.
 * Returns `[]` for an existing but empty directory.
 * A subdirectory removed while the walk runs is skipped.
 *
 * All paths in the result are normalized to `/` separators.
 *
 * @example
 * ```ts
 * await listDir('./src', { ext: ['ts', 'tsx'], depth: 1 })
 * // -> [{ relativePath: 'ui/button.tsx', name: 'button.tsx', type: 'file', ... }]
 *
 * await listDir('./missing')
 * // -> null
 * ```
 */
export async function listDir(
  path: string,
  options: ListDirOptions = {},
): Promise<DirEntry[] | null> {
  const {
    depth = Infinity,
    files = true,
    dirs = false,
    ext,
    filter,
    descend,
    hidden = false,
    followSymlinks = false,
  } = options;

  const root = resolvePath(path);
  const allowedExts = isUndefined(ext) ? null : normalizeExtensions(ext);

  const rootDir = await openDir(root);
  if (isNull(rootDir)) return null;

  const results: DirEntry[] = [];
  await walk(rootDir, '', 0);
  return results;

  /**
   * Collects the wanted entries of `dir` into `results`, descending while `currentDepth` is below `depth`.
   * `prefix` is the path of `dir` relative to the root, with a trailing `/` below the root.
   */
  async function walk(dir: Dir, prefix: string, currentDepth: number): Promise<void> {
    for await (const dirent of dir) {
      const name = dirent.name;
      if (!hidden && name.startsWith('.')) continue;

      const relative = prefix + name;
      const entryPath = childPath(root, relative);
      const type = await resolveType(dirent, entryPath, followSymlinks);
      if (isNull(type)) continue;

      const entryExt = extname(name);
      const stem = entryExt.length > 0 ? name.slice(0, -entryExt.length) : name;
      const entry: DirEntry = {
        path: entryPath,
        relativePath: relative,
        name,
        stem,
        ext: entryExt,
        type,
      };

      const typeWanted = (type === 'file' && files) || (type === 'directory' && dirs);
      const extWanted = type === 'directory' || isNull(allowedExts) || allowedExts.has(entryExt);
      if (typeWanted && extWanted && (!filter || filter(entry))) {
        results.push(entry);
      }

      if (type === 'directory' && currentDepth < depth && (!descend || (await descend(entry)))) {
        const subdir = await openDir(entryPath);
        if (!isNull(subdir)) await walk(subdir, `${relative}/`, currentDepth + 1);
      }
    }
  }
}

/**
 * Opens the directory at `path`, or resolves `null` when nothing is there.
 */
async function openDir(path: string): Promise<Dir | null> {
  try {
    return await opendir(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Collects extensions into a set, each with its leading dot.
 */
function normalizeExtensions(ext: string | string[]): Set<string> {
  const list = isArray(ext) ? ext : [ext];
  return new Set(list.map((value) => (value.startsWith('.') ? value : `.${value}`)));
}

/**
 * Classifies a dirent as file or directory, or `null`; a symlink resolves only with `followSymlinks`.
 */
async function resolveType(
  dirent: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean },
  entryPath: string,
  followSymlinks: boolean,
): Promise<'file' | 'directory' | null> {
  if (dirent.isFile()) return 'file';
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isSymbolicLink() && followSymlinks) {
    try {
      const st = await stat(entryPath);
      if (st.isFile()) return 'file';
      if (st.isDirectory()) return 'directory';
    } catch {
      return null;
    }
  }
  return null;
}
