import { pathToFileURL } from 'node:url';

import type { Config } from '../layers/config.ts';

import { exists } from '../../utils/fs/index.ts';
import { joinPath } from '../../utils/index.ts';

/**
 * Reads a single layer's own config: the default export of its `ohne.config.ts`.
 *
 * This is the shallow read the cascade walks on - it reads one layer, never merges.
 * Returns `null` when the directory has no `ohne.config.ts`.
 * A config that fails to import propagates, so a syntax error in it is not swallowed.
 *
 * @example
 * ```ts
 * await readLayerConfig('/srv/app')         // -> { layers: ['@acme/base'] }
 * await readLayerConfig('/srv/not-a-layer') // -> null
 * ```
 */
export async function readLayerConfig(dir: string): Promise<Config | null> {
  const file = joinPath(dir, 'ohne.config.ts');
  if (!(await exists(file))) return null;

  const module = await import(pathToFileURL(file).href);
  return (module.default ?? null) as Config | null;
}
