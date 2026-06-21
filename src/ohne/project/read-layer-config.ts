import { pathToFileURL } from 'node:url';

import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from '../layers/config.ts';
import type { LayerDefinition } from '../layers/define-layer.ts';

import { exists } from '../../utils/fs/index.ts';
import { joinPath } from '../../utils/index.ts';

/**
 * A directory's config, split by ownership.
 * `input` is what the project sets; `defaults` and `strategies` are what it owns.
 */
export interface LayerConfig {
  /**
   * Values from the project's `ohne.config.ts`.
   */
  input: Config;

  /**
   * Default values from the project's `ohne.layer.ts`, or `{}` when there is none.
   */
  defaults: Config;

  /**
   * Merge strategies from the project's `ohne.layer.ts`, or `{}` when there is none.
   */
  strategies: LayerStrategies;
}

async function importDefault<T>(file: string): Promise<T | null> {
  const module = await import(pathToFileURL(file).href);
  return (module.default ?? null) as T | null;
}

/**
 * Reads a directory's config, normalized to its input plus the defaults and strategies it owns.
 *
 * This is the shallow read the cascade walks on - it reads one directory, never merges.
 * Returns `null` when the directory has no `ohne.config.ts`: it is not an ohne project.
 * `ohne.layer.ts` is optional; its absence yields empty `defaults` and `strategies`.
 * A config that fails to import propagates, so a syntax error in it is not swallowed.
 *
 * @example
 * ```ts
 * await readLayerConfig('/srv/app')
 * // -> { input: { layers: ['@acme/base'] }, defaults: {}, strategies: {} }
 *
 * await readLayerConfig('/srv/not-a-layer') // -> null
 * ```
 */
export async function readLayerConfig(dir: string): Promise<LayerConfig | null> {
  const configFile = joinPath(dir, 'ohne.config.ts');
  if (!(await exists(configFile))) return null;
  const input = (await importDefault<Config>(configFile)) ?? {};

  const layerFile = joinPath(dir, 'ohne.layer.ts');
  const layer = (await exists(layerFile)) ? await importDefault<LayerDefinition>(layerFile) : null;

  return { input, defaults: layer?.defaults ?? {}, strategies: layer?.strategies ?? {} };
}
