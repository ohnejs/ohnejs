import { bootLayers } from '../boot/boot-layers.ts';
import { generateLayerName } from '../codegen/generate-layer-name.ts';
import { generateResolvedConfig } from '../codegen/generate-resolved-config.ts';
import { generateRoutes } from '../codegen/generate-routes.ts';
import { useEnv } from '../env/use-env.ts';
import { loadLayers } from '../layers/load-layers.ts';

/**
 * Boots the API backend for the project rooted at `from`.
 *
 * Resolves and registers the layer stack, runs every layer's boot files, then regenerates types.
 * Boot runs before codegen so the hooks codegen consults are already registered.
 * Codegen is skipped when the `SKIP_CODEGEN` env is truthy.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function serveAPI(from: string = process.cwd()): Promise<void> {
  await loadLayers(from);
  await bootLayers();

  if (!useEnv().get('SKIP_CODEGEN')) {
    await Promise.all([
      generateLayerName(from),
      generateResolvedConfig(from),
      generateRoutes(from),
    ]);
  }
}
