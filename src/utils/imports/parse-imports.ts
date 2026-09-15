const STATIC_IMPORT = /\bimport\b[\s\S]*?\bfrom\b\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /\bimport\b\s*['"]([^'"]+)['"]/g;
const REEXPORT = /\bexport\b[\s\S]*?\bfrom\b\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\b\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

/**
 * Extracts every module specifier from a source string.
 * Covers static `import`, `export ... from`, and dynamic `import(...)`.
 * Returns each specifier verbatim and deduped; resolution and filtering happen later.
 *
 * A zero-dep matcher biased to over-capture.
 * A false positive only causes extra rebuilds, while a false negative silently misses a dependency.
 * So it matches inside comments and strings rather than risk dropping a real specifier.
 * A computed `import(expr)` is skipped; a template literal is captured verbatim, `${...}` included.
 *
 * @example
 * ```ts
 * parseImports("import './a.ts'")        // -> ['./a.ts']
 * parseImports("export * from './b'")    // -> ['./b']
 * parseImports("await import('./c.ts')") // -> ['./c.ts']
 * ```
 */
export function parseImports(source: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [STATIC_IMPORT, SIDE_EFFECT_IMPORT, REEXPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}
