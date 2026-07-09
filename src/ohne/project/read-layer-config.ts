import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from '../layers/config.ts';
import type { LayerDefinition } from '../layers/define-layer.ts';

import { exists, importDefault } from '../../utils/fs/index.ts';
import { joinPath } from '../../utils/index.ts';
import { validateConfigDirs } from '../layers/validate-config-dirs.ts';

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

/**
 * Options for reading and resolving layer config.
 */
export interface LayerLoadOptions {
  /**
   * Re-import each `ohne.config.ts` and `ohne.layer.ts` fresh, past the module cache.
   * The dev supervisor sets this to pick up edits in its own long-lived process; a normal boot never does.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Reads a directory's config, normalized to its input plus the defaults and strategies it owns.
 *
 * This is the shallow read the cascade walks on - it reads one directory, never merges.
 * Returns `null` when the directory has no `ohne.config.ts`: it is not an ohne project.
 * `ohne.layer.ts` is optional; its absence yields empty `defaults` and `strategies`.
 * A config that fails to import propagates, so a syntax error in it is not swallowed.
 *
 * Pass `fresh` to re-import past the module cache, so an edited config is read again.
 *
 * @example
 * ```ts
 * await readLayerConfig('/srv/app')
 * // -> { input: { layers: ['@acme/base'] }, defaults: {}, strategies: {} }
 *
 * await readLayerConfig('/srv/not-a-layer') // -> null
 * ```
 */
export async function readLayerConfig(
  dir: string,
  options: LayerLoadOptions = {},
): Promise<LayerConfig | null> {
  const { fresh = false } = options;
  const configFile = joinPath(dir, 'ohne.config.ts');
  if (!(await exists(configFile))) return null;
  const input = (await importDefault<Config>(configFile, { fresh })) ?? {};
  if (input.dirs) validateConfigDirs(input.dirs, configFile);

  const layerFile = joinPath(dir, 'ohne.layer.ts');
  const layer = (await exists(layerFile))
    ? await importDefault<LayerDefinition>(layerFile, { fresh })
    : null;

  return { input, defaults: layer?.defaults ?? {}, strategies: layer?.strategies ?? {} };
}
