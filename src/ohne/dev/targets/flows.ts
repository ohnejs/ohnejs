import { generateFlows } from '../../codegen/generate-flows.ts';
import { collectFlows } from '../../flows/collect-flows.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The flow table target.
 * Its closure is every layer's `dirs.flows`; it regenerates `flows.ts` when that file set changes.
 * Definitions re-import fresh, so a flow file once read in a broken state recovers on the next cycle.
 */
export function createFlowsTarget(from: string): SetTarget {
  return createSetTarget('flows', from, 'flows', flowFiles, (dir) =>
    generateFlows(dir, { fresh: true }),
  );
}

/**
 * The source files of every stacked layer's flows, re-imported fresh so a fixed file recovers.
 */
async function flowFiles(): Promise<Set<string>> {
  const flows = await collectFlows(stackedLayers(), { fresh: true });
  return new Set(flows.map((flow) => flow.file));
}
