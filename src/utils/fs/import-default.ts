import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Options for `importDefault`.
 */
export interface ImportDefaultOptions {
  /**
   * Re-import the module fresh, past the module cache, keyed by the file's mtime.
   * A long-lived process sets it to pick up edits; a normal boot never does.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Imports a module by absolute file path and returns its default export.
 * Returns `null` when the module has no default export.
 * With `fresh`, the import URL carries the file's mtime, so an edited file is read again.
 *
 * @example
 * ```ts
 * await importDefault<Config>('/app/ohne.config.ts')
 * // -> { layers: [...] }
 *
 * await importDefault<Config>('/app/ohne.config.ts', { fresh: true })
 * // -> the edited module
 * ```
 */
export async function importDefault<T>(
  file: string,
  options: ImportDefaultOptions = {},
): Promise<T | null> {
  const { fresh = false } = options;
  const href = pathToFileURL(file).href;
  const url = fresh ? `${href}?v=${(await stat(file)).mtimeMs}` : href;
  const module = await import(url);
  return (module.default ?? null) as T | null;
}
