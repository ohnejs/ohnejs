import type { SetTarget } from './set-target.ts';

import {
  isNull,
  isPathInside,
  isUndefined,
  joinPath,
  normalizePath,
} from '../../../utils/index.ts';
import { generateContracts } from '../../codegen/generate-contracts.ts';
import { collectContracts, CONTRACT_FILE } from '../../contracts/collect-contracts.ts';
import { readContractModules } from '../../contracts/read-contract-modules.ts';
import { DIR_DEFAULTS } from '../../layers/config.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { useConfig } from '../../layers/use-config.ts';
import { useLayers } from '../../layers/use-layers.ts';

/**
 * The route contracts target.
 *
 * Its closure is each layer's `ohne.contract.ts` and `dirs.api`.
 * With `api.types` set, every contract module joins it.
 * `regen` rewrites `node/contracts.ts`, and with `api.types` set rereads the contract modules.
 * After a failure any change reruns it, so creating a missing module recovers too.
 * The layer codegen that follows it writes the `api.types` file.
 * `invalidate` is a no-op: `regen` always runs and writes only on a change.
 */
export function createContractsTarget(from: string): SetTarget {
  let modules = new Set<string>();
  let failed = false;
  return {
    id: 'contracts',
    affectedBy(changedPath) {
      const path = normalizePath(changedPath);
      if (failed || modules.has(path)) return true;
      return useLayers()
        .layers()
        .some(
          (layer) =>
            path === joinPath(layer.path, CONTRACT_FILE) ||
            isPathInside(path, joinPath(layer.path, layer.input.dirs?.api ?? DIR_DEFAULTS.api)),
        );
    },
    async regen() {
      failed = true;
      const written = await generateContracts(from);
      modules = new Set();
      if (!isUndefined(useConfig().api.types)) {
        const entries = await collectContracts(stackedLayers());
        const read = await readContractModules(entries.map((entry) => entry.file));
        modules = new Set(read.map((module) => module.file));
      }
      failed = false;
      return isNull(written) ? [] : [written];
    },
    invalidate() {},
  };
}
