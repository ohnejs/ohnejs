import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { useLayers } from '../layers/use-layers.ts';
import { resolveDependencyLayerNames } from '../project/resolve-dependency-layer-names.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';
import { scanLayerAugmentations } from './scan-layer-augmentations.ts';

/**
 * Generates the `LayerName` type from the app's ohne dependency closure.
 * Emits `node/layer-name.ts` so `LayerName` resolves to a string-literal union of every layer's name.
 * Falls back to `string` when the closure has no ohne layers.
 *
 * Alongside the union, imports each file in a stacked layer that augments `ohnejs` via `declare module`.
 * Loading them applies each layer's ambient augmentations (hooks, env, dialects) to the app's type program.
 * This is the type-side counterpart to `bootLayers`, which imports the same stacked layers at runtime.
 * The union spans the whole dependency closure, every layer you may list.
 * The imports track only the layers actually stacked through `Config.layers`, matching what boots.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `node` bucket of the app's `dirs.codegen` (default `.ohne`).
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateLayerName(from: string = process.cwd()): Promise<string | null> {
  const dir = await codegenBucket(from, 'node');
  if (isNull(dir)) return null;

  const names = await resolveDependencyLayerNames(from);
  const layers = useLayers().layers().slice(0, -1);
  const files = (
    await Promise.all(layers.map((layer) => scanLayerAugmentations(layer.path)))
  ).flat();

  const code = createCodeBuilder();
  if (files.length === 0) {
    code.line("import type {} from 'ohnejs';");
  } else {
    for (const file of files) {
      code.line(`import type {} from ${literalString(importSpecifier(dir, file))};`);
    }
  }
  code.line();
  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    if (names.length === 0) {
      code.line('interface KnownLayers {}');
    } else {
      code.line('interface KnownLayers {');
      code.indent(() => {
        for (const name of names) code.line(`${literalString(name)}: true;`);
      });
      code.line('}');
    }
  });
  code.line('}');

  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('layer-name.ts', code.toString());
  return gen.path('layer-name.ts');
}
