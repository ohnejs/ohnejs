import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { FlowDefinition } from './define-flow.ts';

import { isPlainObject } from '../../utils/index.ts';
import {
  collectLayerFiles,
  type CollectedFile,
  type CollectLayerFilesOptions,
} from '../layers/collect-layer-files.ts';

/**
 * One flow with its imported definition under `flow`, ready for codegen.
 */
export type CollectedFlow = CollectedFile<'flow', FlowDefinition>;

/**
 * Combines the flows of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.flows` (default `'flows'`).
 * A closer layer's flow replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export function collectFlows(
  layers: readonly OhneLayer[],
  options: CollectLayerFilesOptions = {},
): Promise<CollectedFlow[]> {
  return collectLayerFiles('flow', layers, isFlowDefinition, options);
}

/**
 * Whether a default export has the shape of a `defineFlow` result.
 */
function isFlowDefinition(definition: unknown): definition is FlowDefinition {
  return isPlainObject(definition) && isPlainObject(definition.nodes);
}
