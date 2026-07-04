import { relativePath } from '../path/relative-path.ts';

/**
 * Builds a relative ESM import specifier from `fromDir` to `file`.
 * Resolves the path between them, then makes it import-usable by prefixing `./` when it has no leading dot.
 * A bare `foo.ts` would read as a package specifier, so it becomes `./foo.ts`.
 *
 * Each segment is percent-encoded, since an ESM specifier is a URL.
 * So a name holding `%`, `#`, `?`, a space, or a non-ASCII character still resolves to the right file.
 *
 * @example
 * ```ts
 * importSpecifier('/app/.gen', '/app/api/users.ts')  // -> '../api/users.ts'
 * importSpecifier('/app/.gen', '/app/.gen/code.ts')  // -> './code.ts'
 * importSpecifier('/app/.gen', '/app/api/50%off.ts') // -> '../api/50%25off.ts'
 * ```
 */
export function importSpecifier(fromDir: string, file: string): string {
  const rel = relativePath(fromDir, file);
  const encoded = rel
    .split('/')
    .map((segment) => (segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)))
    .join('/');
  return encoded.startsWith('.') ? encoded : `./${encoded}`;
}
