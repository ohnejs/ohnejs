import { pathToFileURL } from 'node:url';

import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerBoot } from './scan-layer-boot.ts';

/**
 * Runs every layer's boot files, registering hooks and any other startup side-effects.
 *
 * Reads the stack from `useLayers`, so `loadLayers` must have run first.
 * Layers run furthest-first: a base layer boots before the app, so its hooks register ahead.
 * Each layer's boot directory is its own `dirs.boot` (default `'boot'`).
 * Files run in the order `scanLayerBoot` returns, each awaited before the next.
 *
 * Importing a file runs its module body once; Node caches it, so a second `bootLayers` is a no-op.
 *
 * @example
 * ```ts
 * await loadLayers()
 * await bootLayers()
 * ```
 */
export async function bootLayers(): Promise<void> {
  for (const layer of useLayers().layers()) {
    const boot = layer.input.dirs?.boot ?? DIR_DEFAULTS.boot;
    for (const file of await scanLayerBoot(layer.path, boot)) {
      await import(pathToFileURL(file).href);
    }
  }
}
