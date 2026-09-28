import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { stat } from './stat.ts';

/**
 * Options for `importDefault`.
 */
export interface ImportDefaultOptions {
  /**
   * Re-import the module and its `_` helpers past the module cache, once any of them was edited.
   * A long-lived process sets it to pick up edits; a normal boot never does.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Every helper a fresh import has reached, by path; an edit to one re-imports every fresh module.
 */
const helpers = new Set<string>();
let tracking = false;

/**
 * Imports a module by absolute file path and returns its default export.
 * Returns `null` when the module has no default export.
 * With `fresh`, an edited file is read again, and so are its `_` helpers.
 * A helper is a relative import through a `_`-prefixed file or directory; any other import stays shared.
 *
 * @example
 * ```ts
 * await importDefault<Settings>('/app/settings.ts')
 * // -> { port: 3000 }
 *
 * await importDefault<Settings>('/app/settings.ts', { fresh: true })
 * // -> { port: 4000 }, read again after an edit
 * ```
 */
export async function importDefault<T>(
  file: string,
  options: ImportDefaultOptions = {},
): Promise<T | null> {
  const { fresh = false } = options;
  const href = pathToFileURL(file).href;
  if (fresh) trackHelpers();
  const url = fresh ? `${href}?v=${await mtimeSum([file, ...helpers])}` : href;
  const module = await import(url);
  return (module.default ?? null) as T | null;
}

/**
 * Carries a fresh import's `?v=` onto the `_`-prefixed helpers it imports relatively, recording each.
 * The chain stops at any other import, so a module holding shared state keeps its one instance.
 */
function trackHelpers(): void {
  if (tracking) return;
  tracking = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!isHelper(specifier) || isUndefined(context.parentURL)) return resolved;
      const version = new URL(context.parentURL).searchParams.get('v');
      if (isNull(version)) return resolved;

      const url = new URL(resolved.url);
      url.searchParams.set('v', version);
      helpers.add(fileURLToPath(url));
      return { ...resolved, url: url.href };
    },
  });
}

/**
 * Whether a specifier is relative and passes through a `_`-prefixed file or directory.
 */
function isHelper(specifier: string): boolean {
  return specifier.startsWith('.') && specifier.split('/').some((part) => part.startsWith('_'));
}

/**
 * The sum of the mtimes of `files`, a missing one counting `0`, so an edit to any of them changes it.
 */
async function mtimeSum(files: string[]): Promise<number> {
  const stats = await Promise.all(files.map(stat));
  return stats.reduce((sum, entry) => sum + (entry?.mtimeMs ?? 0), 0);
}
