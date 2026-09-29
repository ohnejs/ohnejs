import type { FlowDefinition } from './define-flow.ts';
import type { FlowName } from './known-flows.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One registered flow: its name and its definition.
 */
export interface FlowMeta {
  /**
   * The flow name, taken from its file.
   */
  name: FlowName;

  /**
   * The flow definition.
   */
  flow: FlowDefinition;
}

const registry: Registry<FlowMeta> = createRegistry<FlowMeta>();

/**
 * Returns the process-wide flow registry, keyed by flow name.
 *
 * Core ships no flows; codegen registers every layer's own.
 * A name that already exists is overridden, so a flow from a closer layer wins.
 *
 * @example
 * ```ts
 * useFlows().get('raid-officer')?.flow.start // -> 'triage'
 * ```
 */
export function useFlows(): Registry<FlowMeta> {
  return registry;
}
