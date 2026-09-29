import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
  propertyKey,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { collectFlows } from '../flows/collect-flows.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Options for `generateFlows`.
 */
export interface GenerateFlowsOptions {
  /**
   * Re-import each flow definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Generates the flow tables from every layer's flows directory.
 *
 * Emits `shared/flows.ts`, the pure name table: `GeneratedFlows` and the `GeneratedFlowName` union.
 * It is import-free, so both type programs load it; with no flows the union falls back to `string`.
 * Emits `node/flows.ts`, which extends `KnownFlows` from it and registers each flow into `useFlows`.
 * Each flow is statically imported from its source file by relative path.
 *
 * Flows are read from each layer's `Config.dirs.flows` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * A closer layer overrides an earlier flow with the same name.
 * Names in `Config.disable.flows` drop before emission.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `shared` and `node` buckets of the app's `dirs.codegen` (default `.ohne`).
 *
 * A file is rewritten only when its contents change.
 * Returns the absolute paths written, or `null` when no `package.json` is found.
 */
export async function generateFlows(
  from: string = process.cwd(),
  options: GenerateFlowsOptions = {},
): Promise<string[] | null> {
  const sharedDir = await codegenBucket(from, 'shared');
  const nodeDir = await codegenBucket(from, 'node');
  if (isNull(sharedDir) || isNull(nodeDir)) return null;

  const { fresh = false } = options;
  const flows = await collectFlows(stackedLayers(), {
    disable: useConfig().disable.flows,
    fresh,
  });

  const shared = createCodeBuilder();
  if (flows.length === 0) {
    shared.line('export interface GeneratedFlows {}');
  } else {
    shared.line('export interface GeneratedFlows {');
    shared.indent(() => {
      flows.forEach((flow) => shared.line(`${propertyKey(flow.name)}: true;`));
    });
    shared.line('}');
  }
  shared.line();
  shared.line(
    'export type GeneratedFlowName = [keyof GeneratedFlows] extends [never] ? string : keyof GeneratedFlows;',
  );

  const code = createCodeBuilder();
  code.line("import type { GeneratedFlows } from '../shared/flows.ts';");
  if (flows.length > 0) code.line("import { useFlows } from 'ohnejs';");
  flows.forEach((flow, index) => {
    code.line(`import f${index} from ${literalString(importSpecifier(nodeDir, flow.file))};`);
  });
  code.line();

  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    code.line('interface KnownFlows extends GeneratedFlows {}');
  });
  code.line('}');

  if (flows.length > 0) {
    code.line();
    code.line('const flows = useFlows();');
    flows.forEach((flow, index) => {
      const name = literalString(flow.name);
      code.line(`flows.register(${name}, { name: ${name}, flow: f${index} });`);
    });
  }

  const sharedGen = createCodeGenerator({ dir: sharedDir, banner: BANNER });
  await sharedGen.write('flows.ts', shared.toString());
  const nodeGen = createCodeGenerator({ dir: nodeDir, banner: BANNER });
  await nodeGen.write('flows.ts', code.toString());
  return [sharedGen.path('flows.ts'), nodeGen.path('flows.ts')];
}
