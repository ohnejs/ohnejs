import type { AnyBlockDefinition } from './define-block.ts';
import type { BlockName } from './known-blocks.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One registered block: its name and its definition.
 */
export interface BlockMeta {
  /**
   * The block name, taken from its file.
   */
  name: BlockName;

  /**
   * The block definition, widened so any concrete `defineBlock` result fits.
   */
  block: AnyBlockDefinition;
}

const registry: Registry<BlockMeta> = createRegistry<BlockMeta>();

/**
 * Returns the process-wide block registry, keyed by block name.
 *
 * Core ships no blocks; codegen registers every layer's own.
 * A name that already exists is overridden, so a block from a closer layer wins.
 *
 * @example
 * ```ts
 * useBlocks().keys() // -> ['Hero', 'PricingCard']
 * ```
 */
export function useBlocks(): Registry<BlockMeta> {
  return registry;
}
