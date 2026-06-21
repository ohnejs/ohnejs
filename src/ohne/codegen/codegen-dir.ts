import { findUp } from '../../utils/fs/index.ts';
import { dirname, isNull, joinPath } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';

/**
 * Resolves the app's codegen output directory as an absolute path.
 *
 * Reads the app's own `dirs.codegen`, found by its directory in the layer registry.
 * The output directory is the app's choice, never inherited from a dependency through the merge.
 * Falls back to `DIR_DEFAULTS.codegen` when the app does not set it.
 *
 * The app root is the nearest `package.json` above `from`.
 * Returns `null` when no `package.json` is found.
 */
export async function codegenDir(from: string): Promise<string | null> {
  const manifestPath = await findUp('package.json', from);
  if (isNull(manifestPath)) return null;

  const appDir = dirname(manifestPath);
  const own = useLayers()
    .layers()
    .find((layer) => layer.path === appDir)?.input.dirs?.codegen;
  return joinPath(appDir, own ?? DIR_DEFAULTS.codegen);
}
