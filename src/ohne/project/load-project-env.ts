import { loadEnv } from '../../utils/env/index.ts';
import { errorMessage, joinPath, relativePath } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { usePrinter } from '../printer/use-printer.ts';

/**
 * Loads the project `.env` into the process environment.
 *
 * Reads `.env` at `root`, the directory holding `ohne.config.ts`, and fills every name the process lacks.
 * A name the shell, the host, or a supervising `ohne dev` already set keeps its value.
 * A missing file applies nothing, so production runs the same path with no file present.
 * A repeat call replaces what the previous one applied, which is how `ohne dev` picks up an edited file.
 * Readers cached in an `effect` or `computed` re-run, since the fill goes through `useEnv().fill`.
 * A file that cannot be read or parsed throws an `ohneError` naming it.
 * Returns the names it applied.
 *
 * @example
 * ```ts
 * await loadProjectEnv('/srv/app') // -> ['DATABASE', 'COOKIE_SECRET']
 * ```
 */
export async function loadProjectEnv(root: string): Promise<readonly string[]> {
  const file = joinPath(root, '.env');
  let applied: readonly string[];
  try {
    applied = useEnv().fill(await loadEnv(file));
  } catch (error) {
    throw ohneError({ title: 'Could not load `.env`', body: [errorMessage(error)], path: file });
  }
  if (applied.length > 0) {
    const names = applied.map((name) => `\`${name}\``).join(', ');
    usePrinter().debug(`Loaded ${names} from \`${relativePath(process.cwd(), file)}\``);
  }
  return applied;
}
