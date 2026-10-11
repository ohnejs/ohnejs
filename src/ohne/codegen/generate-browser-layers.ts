import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { dashboardRoots } from '../dashboard/dashboard-roots.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';
import { scanLayerAugmentations } from './scan-layer-augmentations.ts';

/**
 * Generates `browser/layers.ts`, which carries every stacked layer's `ohnejs/dashboard` augmentations.
 *
 * Imports each file in a stacked layer's dashboard directory that augments `ohnejs/dashboard`.
 * Loading them applies each layer's augmentations, like a registered field type, to the browser program.
 * This is the browser counterpart to the augmentation imports in `node/layer-name.ts`.
 * The app's own dashboard directory is skipped, since the browser program already includes it.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `browser` bucket of the app's `dirs.codegen` (default `.ohne`).
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateBrowserLayers(from: string = process.cwd()): Promise<string | null> {
  const dir = await codegenBucket(from, 'browser');
  if (isNull(dir)) return null;

  const roots = dashboardRoots(stackedLayers().slice(0, -1)).reverse();
  const files = (
    await Promise.all(roots.map((root) => scanLayerAugmentations(root, 'ohnejs/dashboard')))
  ).flat();

  const code = createCodeBuilder();
  if (files.length === 0) {
    code.line("import type {} from 'ohnejs/dashboard';");
  } else {
    for (const file of files) {
      code.line(`import type {} from ${literalString(importSpecifier(dir, file))};`);
    }
  }

  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('layers.ts', code.toString());
  return gen.path('layers.ts');
}
