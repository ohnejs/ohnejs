import { watchTree } from '../../utils/fs/index.ts';
import { basename, last, normalizePath } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';

/**
 * A live, layer-scoped file watch the dev supervisor drives.
 *
 * It watches every used layer's directory except installed dependencies.
 * Each change is reported through the `onChange` passed to `watchLayers`.
 * The supervisor owns the registry; this watch only reads it.
 */
export interface LayerWatch {
  /**
   * Re-reads the layer set from the registry and reconciles the live watches.
   *
   * The supervisor calls this after the config barrier reloads the registry.
   * Newly stacked layers start being watched and removed ones are torn down.
   * A layer that stays keeps its existing watch.
   * When the codegen dir name changes, every watch is rebuilt so the new name is pruned.
   */
  resync(): void;

  /**
   * Tears down every layer watch.
   */
  close(): void;
}

/**
 * Watches the resolved layer stack and reports each file change to `onChange`.
 *
 * Watches each layer's directory from the registry.
 * Layers whose directory lies under `node_modules` are skipped - installed deps never change in dev.
 * A workspace or linked layer resolves to its source directory outside `node_modules`, so it stays watched.
 *
 * Inside each watched directory, `watchTree` prunes `node_modules`, dot-dirs, and the codegen output dir.
 * A generated file write therefore never reports a change.
 *
 * The registry must already be populated, since the supervisor runs `loadLayers` first.
 * Call `resync` after a config change re-resolves the stack, and `close` to tear every watch down.
 *
 * @example
 * ```ts
 * const watch = watchLayers((path) => pending.add(path))
 * watch.resync() // after the config barrier reloads the registry
 * watch.close()  // on shutdown
 * ```
 */
export function watchLayers(onChange: (path: string) => void): LayerWatch {
  const watchers = new Map<string, () => void>();
  let ignoreName: string | null = null;
  resync();
  return { resync, close };

  function resync(): void {
    const ignore = codegenName();
    if (ignore !== ignoreName) {
      ignoreName = ignore;
      close();
    }
    const desired = new Set(watchedDirs());
    for (const [dir, stop] of watchers) {
      if (!desired.has(dir)) {
        stop();
        watchers.delete(dir);
      }
    }
    for (const dir of desired) {
      if (!watchers.has(dir)) watchers.set(dir, watchTree(dir, onChange, { ignore: [ignore] }));
    }
  }

  function close(): void {
    for (const stop of watchers.values()) stop();
    watchers.clear();
  }
}

function watchedDirs(): string[] {
  return useLayers()
    .layers()
    .map((layer) => layer.path)
    .filter((dir) => !normalizePath(dir).split('/').includes('node_modules'));
}

function codegenName(): string {
  const app = last(useLayers().layers());
  return basename(app?.input.dirs?.codegen ?? DIR_DEFAULTS.codegen);
}
