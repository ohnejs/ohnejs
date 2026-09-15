import { readFile } from '../fs/read-file.ts';
import { isNull } from '../is/is-null.ts';
import { resolvePath } from '../path/resolve-path.ts';
import { parseImports } from './parse-imports.ts';
import { resolveImport } from './resolve-import.ts';

/**
 * Walks the import graph from `entry`.
 * Returns the entry plus every project file reachable through its relative imports.
 * Bare and external specifiers are not followed; unreadable files are dropped.
 * Cycles terminate via a visited set.
 *
 * @example
 * ```ts
 * await importClosure('/app/schema.ts')
 * // -> Set { '/app/schema.ts', '/app/field.ts', '/app/types.ts' }
 * ```
 */
export async function importClosure(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  await visit(resolvePath(entry));
  return seen;

  async function visit(file: string): Promise<void> {
    if (seen.has(file)) return;
    seen.add(file);

    const source = await readFile(file);
    if (isNull(source)) return;

    const deps = await Promise.all(
      parseImports(source).map((specifier) => resolveImport(file, specifier)),
    );
    for (const dep of deps) {
      if (!isNull(dep)) await visit(dep);
    }
  }
}
