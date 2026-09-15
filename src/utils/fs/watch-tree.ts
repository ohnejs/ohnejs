import type { Dirent, FSWatcher } from 'node:fs';

import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

import { isNull } from '../is/is-null.ts';
import { basename } from '../path/basename.ts';
import { joinPath } from '../path/join-path.ts';
import { resolvePath } from '../path/resolve-path.ts';

/**
 * Options for `watchTree`.
 */
export interface WatchTreeOptions {
  /**
   * Extra directory names to skip, on top of `node_modules` and any dot-prefixed name.
   * Matched by name at every level of the walk.
   *
   * @default
   * []
   */
  ignore?: string[];
}

const ALWAYS_IGNORED = 'node_modules';

/**
 * Recursively watches a directory tree, calling `onChange` with the absolute path of each change.
 *
 * Watches each directory in the tree, picking up new ones as they appear.
 * Directories named `node_modules`, dot-prefixed names, and any `ignore` name are skipped.
 * Events inside a skipped directory are not reported.
 *
 * Returns a closer that tears down every watch.
 *
 * @example
 * ```ts
 * const stop = watchTree('./src', (path) => rebuild(path))
 * // ...later
 * stop() // tear down every watch
 *
 * watchTree('./app', onChange, { ignore: ['dist'] })
 * ```
 */
export function watchTree(
  dir: string,
  onChange: (path: string) => void,
  options: WatchTreeOptions = {},
): () => void {
  const ignore = new Set(options.ignore);
  const watchers = new Map<string, FSWatcher>();
  const reconciles = new Map<string, Promise<void>>();
  let closed = false;
  let ready = false;

  const pruned = (name: string): boolean =>
    name.startsWith('.') || name === ALWAYS_IGNORED || ignore.has(name);

  void watchDir(resolvePath(dir), false).then(() => {
    ready = true;
  });

  return () => {
    closed = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  /**
   * Watches `path` and walks its subtree, skipping a path already watched or unwatchable.
   */
  async function watchDir(path: string, emitExisting: boolean): Promise<void> {
    if (closed || watchers.has(path)) return;

    let watcher: FSWatcher;
    try {
      watcher = watch(path, (_event, filename) => onEvent(path, filename));
    } catch {
      return;
    }
    if (closed) {
      watcher.close();
      return;
    }
    watcher.on('error', () => {
      watcher.close();
      watchers.delete(path);
    });
    watchers.set(path, watcher);

    await walk(path, emitExisting);
  }

  /**
   * Watches each unpruned subdirectory of `path`, reporting each unpruned file when `emitExisting` is set.
   */
  async function walk(path: string, emitExisting: boolean): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map((entry) => {
        if (pruned(entry.name)) return undefined;
        const child = joinPath(path, entry.name);
        if (entry.isDirectory()) return watchDir(child, emitExisting);
        if (emitExisting) onChange(child);
        return undefined;
      }),
    );
  }

  /**
   * Reports and re-syncs the unpruned path that changed; a null `filename` reports `watchedDir` itself.
   */
  function onEvent(watchedDir: string, filename: string | null): void {
    if (closed) return;
    if (isNull(filename)) {
      onChange(watchedDir);
      return;
    }
    if (pruned(basename(filename))) return;

    const changed = joinPath(watchedDir, filename);
    onChange(changed);
    reconcile(changed);
  }

  /**
   * Reconciles the watch of `changed` against the disk, serialized per path.
   * Chaining per path keeps a delete event and its recreate from racing to a stale end state.
   */
  function reconcile(changed: string): void {
    const prev = reconciles.get(changed) ?? Promise.resolve();
    const next = prev.then(() => syncWatch(changed));
    reconciles.set(changed, next);
    void next.finally(() => {
      if (reconciles.get(changed) === next) reconciles.delete(changed);
    });
  }

  /**
   * Drops the watches at and under `path`, then watches it anew if it is a directory.
   */
  async function syncWatch(path: string): Promise<void> {
    if (closed) return;
    let isDir = false;
    try {
      isDir = (await stat(path)).isDirectory();
    } catch {
      // The entry is gone; fall through to drop any stale watchers under it.
    }
    if (closed) return;
    evictSubtree(path);
    if (isDir) await watchDir(path, ready);
  }

  /**
   * Closes the watch on `path` and on every directory beneath it.
   */
  function evictSubtree(path: string): void {
    const prefix = `${path}/`;
    for (const [key, watcher] of watchers) {
      if (key === path || key.startsWith(prefix)) {
        watcher.close();
        watchers.delete(key);
      }
    }
  }
}
