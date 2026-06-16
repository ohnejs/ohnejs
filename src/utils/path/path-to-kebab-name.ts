import { toKebabCase } from '../case/to-kebab-case.ts';
import { pathNameSegments } from './path-name-segments.ts';

/**
 * Derives a `kebab-case` name from a relative path.
 * Each segment is kebab-cased and joined with `-`.
 * Path boundaries become word boundaries.
 * A trailing `index` segment collapses into its parent.
 *
 * Returns `''` when the path resolves to no segments.
 *
 * @example
 * ```ts
 * pathToKebabName('foo/bar-baz.ts') // -> 'foo-bar-baz'
 * pathToKebabName('foo/index.ts')   // -> 'foo'
 * pathToKebabName('HTML/parser.ts') // -> 'html-parser'
 * pathToKebabName('FooBar/baz.ts')  // -> 'foo-bar-baz'
 * pathToKebabName('index.ts')       // -> ''
 * pathToKebabName('')               // -> ''
 * ```
 */
export function pathToKebabName(relativePath: string): string {
  return pathNameSegments(relativePath).map(toKebabCase).join('-');
}
