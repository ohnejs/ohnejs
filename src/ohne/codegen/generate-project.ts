import { isString } from '../../utils/index.ts';
import { generateBrowserTSConfig } from './generate-browser-tsconfig.ts';
import { generateDatabase } from './generate-database.ts';
import { generateLayerCodegen } from './generate-layer-codegen.ts';
import { generateLayerName } from './generate-layer-name.ts';
import { generateMessages } from './generate-messages.ts';
import { generateMiddleware } from './generate-middleware.ts';
import { generateResolvedConfig } from './generate-resolved-config.ts';
import { generateRoles } from './generate-roles.ts';
import { generateRoutes } from './generate-routes.ts';
import { generateSkills } from './generate-skills.ts';
import { pruneCodegen } from './prune-codegen.ts';

/**
 * Runs every codegen for the project, then prunes the files an earlier run left behind.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns the absolute paths written, empty when no `package.json` is found.
 *
 * @example
 * ```ts
 * await loadLayers()
 * const written = await generateProject()
 * written.includes('/srv/app/.ohne/node/routes.ts') // -> true
 * ```
 */
export async function generateProject(from: string = process.cwd()): Promise<string[]> {
  const written = (
    await Promise.all([
      generateLayerName(from),
      generateResolvedConfig(from),
      generateBrowserTSConfig(from),
      generateRoutes(from),
      generateMiddleware(from),
      generateMessages(from),
      generateDatabase(from),
      generateRoles(from),
      generateSkills(from),
      generateLayerCodegen(from),
    ])
  )
    .flat()
    .filter(isString);
  await pruneCodegen(from, written);
  return written;
}
