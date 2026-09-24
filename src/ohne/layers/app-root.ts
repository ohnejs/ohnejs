import { last } from '../../utils/index.ts';
import { useLayers } from './use-layers.ts';

/**
 * Returns the app root, the directory of the closest layer in the loaded stack.
 * Before a stack loads, it is the process working directory.
 * A relative path an app configures, like `database.url`, resolves against it.
 *
 * @example
 * ```ts
 * await loadLayers('/srv/app')
 * appRoot() // -> '/srv/app'
 * ```
 */
export function appRoot(): string {
  return last(useLayers().layers())?.path ?? process.cwd();
}
