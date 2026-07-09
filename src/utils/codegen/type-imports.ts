import { resolvePath } from '../path/resolve-path.ts';
import { importSpecifier } from './import-specifier.ts';
import { literalString } from './literal-string.ts';

/**
 * A request to reference a named export from another module in generated code.
 */
export interface TypeImportRequest {
  /**
   * The directory the `path` is written relative to - the referencing file's own directory.
   */
  fromDir: string;

  /**
   * The module the export comes from, as written from `fromDir`.
   * A relative path (`'./geo.ts'`) resolves against `fromDir`; a bare package specifier passes through.
   */
  path: string;

  /**
   * The name of the export to reference.
   */
  exportName: string;
}

/**
 * A collector of `import type` references for one generated file, returned by `createTypeImports`.
 */
export interface TypeImports {
  /**
   * Records a reference and returns the local name to use in the generated source.
   *
   * The same export from the same module always returns the same local name.
   * A name that would collide with a different module's export is aliased (`Name`, `Name2`, ...).
   */
  reference(request: TypeImportRequest): string;

  /**
   * Renders the collected imports as `import type` statements, one per module, sorted for stability.
   */
  statements(): string[];
}

/**
 * Creates a collector of `import type` references for a file generated into `outputDir`.
 *
 * `reference` deduplicates by (module, export) and returns the local name to emit.
 * `statements` renders one `import type { ... } from '...'` line per module.
 * Relative paths are re-expressed relative to `outputDir`; package specifiers pass through.
 *
 * @example
 * ```ts
 * const imports = createTypeImports('/app/.ohne')
 *
 * imports.reference({ fromDir: '/app/fields', path: './geo.ts', exportName: 'LatLng' })
 * // -> 'LatLng'
 *
 * imports.reference({ fromDir: '/app/fields', path: 'zod', exportName: 'infer' })
 * // -> 'infer'
 *
 * imports.statements()
 * // -> [
 * //      "import type { LatLng } from '../fields/geo.ts';",
 * //      "import type { infer } from 'zod';"
 * //    ]
 * ```
 */
export function createTypeImports(outputDir: string): TypeImports {
  const entries: { specifier: string; exportName: string; local: string }[] = [];
  const locals = new Set<string>();

  const specifierOf = (fromDir: string, path: string): string =>
    path.startsWith('.') ? importSpecifier(outputDir, resolvePath(path, fromDir)) : path;

  return {
    reference({ fromDir, path, exportName }) {
      const specifier = specifierOf(fromDir, path);
      const existing = entries.find(
        (e) => e.specifier === specifier && e.exportName === exportName,
      );
      if (existing) return existing.local;

      let local = exportName;
      for (let n = 2; locals.has(local); n++) local = `${exportName}${n}`;
      locals.add(local);
      entries.push({ specifier, exportName, local });
      return local;
    },

    statements() {
      const bySpecifier = new Map<string, string[]>();
      for (const { specifier } of entries) bySpecifier.set(specifier, []);
      for (const { specifier, exportName, local } of entries) {
        bySpecifier
          .get(specifier)!
          .push(local === exportName ? exportName : `${exportName} as ${local}`);
      }
      return [...bySpecifier.keys()].sort().map((specifier) => {
        const names = bySpecifier.get(specifier)!.sort().join(', ');
        return `import type { ${names} } from ${literalString(specifier)};`;
      });
    },
  };
}
