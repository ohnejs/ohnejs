import {
  createCodeBuilder,
  createCodeGenerator,
  literalString,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { resolveDependencyLayerNames } from '../project/resolve-dependency-layer-names.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Generates the `LayerName` type from the app's ohne dependency closure.
 * Emits `node/layer-name.ts` so `LayerName` resolves to a string-literal union of every layer's name.
 * Falls back to `string` when the closure has no ohne layers.
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

  const code = createCodeBuilder();
  code.line("import type {} from 'ohne';");
  code.line();
  code.line("declare module 'ohne' {");
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
