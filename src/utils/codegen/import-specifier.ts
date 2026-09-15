import { relativePath } from '../path/relative-path.ts';

/**
 * Builds a relative ESM import specifier from `fromDir` to `file`.
 * Resolves the path between them, then makes it import-usable by prefixing `./` when it has no leading dot.
 * A bare `foo.ts` would read as a package specifier, so it becomes `./foo.ts`.
 *
 * Only `%`, `#`, and `?` are percent-encoded: raw, they break the URL parse a specifier goes through.
 * Every other character - brackets, spaces, non-ASCII - stays raw, which Node resolves to the same file.
 * A specifier emitted into a `.ts` file is also read by TypeScript as a file path, which never decodes it.
 * So encoding a character Node handles raw would only make that import unresolvable to the type checker.
 *
 * @example
 * ```ts
 * importSpecifier('/app/.gen', '/app/api/authors.ts') // -> '../api/authors.ts'
 * importSpecifier('/app/.gen', '/app/.gen/code.ts')   // -> './code.ts'
 * importSpecifier('/app/.gen', '/app/api/[id].ts')    // -> '../api/[id].ts'
 * importSpecifier('/app/.gen', '/app/api/50%off.ts')  // -> '../api/50%25off.ts'
 * ```
 */
export function importSpecifier(fromDir: string, file: string): string {
  const rel = relativePath(fromDir, file).replace(/[%#?]/g, encodeURIComponent);
  return rel.startsWith('.') ? rel : `./${rel}`;
}
