import { relativePath } from '../path/relative-path.ts';

/**
 * Builds a relative ESM import specifier from `fromDir` to `file`.
 * Resolves the path between them, then makes it import-usable by prefixing `./` when it has no leading dot.
 * A bare `foo.ts` would read as a package specifier, so it becomes `./foo.ts`.
 *
 * @example
 * ```ts
 * importSpecifier('/app/.gen', '/app/api/users.ts') // -> '../api/users.ts'
 * importSpecifier('/app/.gen', '/app/.gen/code.ts') // -> './code.ts'
 * ```
 */
export function importSpecifier(fromDir: string, file: string): string {
  const rel = relativePath(fromDir, file);
  return rel.startsWith('.') ? rel : `./${rel}`;
}
