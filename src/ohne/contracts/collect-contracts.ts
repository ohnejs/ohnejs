import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { exists } from '../../utils/fs/index.ts';
import { joinPath } from '../../utils/index.ts';

/**
 * The file at a layer root that types the layer's routes.
 */
export const CONTRACT_FILE = 'ohne.contract.ts';

/**
 * A layer's `ohne.contract.ts`.
 */
export interface ContractEntry {
  /**
   * The layer's name.
   */
  layer: string;

  /**
   * The absolute path of its `ohne.contract.ts`.
   */
  file: string;
}

/**
 * Finds the `ohne.contract.ts` at each layer root, keeping the layers' order, furthest first.
 * A closer layer's entry for a route id wins over a further one's, as its route does.
 *
 * @example
 * ```ts
 * await collectContracts(stackedLayers())
 * // -> [{ layer: 'ohnejs/base', file: '/app/node_modules/ohnejs/src/base/ohne.contract.ts' }]
 * ```
 */
export async function collectContracts(layers: readonly OhneLayer[]): Promise<ContractEntry[]> {
  const entries: ContractEntry[] = [];
  for (const layer of layers) {
    const file = joinPath(layer.dir, CONTRACT_FILE);
    if (await exists(file)) entries.push({ layer: layer.name, file });
  }
  return entries;
}
