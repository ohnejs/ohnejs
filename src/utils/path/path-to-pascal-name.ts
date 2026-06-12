import { toPascalCase } from '../case/to-pascal-case.ts';
import { pathNameSegments } from './path-name-segments.ts';

/**
 * Derives a `PascalCase` name from a relative path.
 * Acronyms survive in any position.
 * A trailing `index` segment collapses into its parent.
 *
 * Returns `''` when the path resolves to no segments.
 *
 * @example
 * ```ts
 * pathToPascalName('foo/bar-baz.ts')   // -> 'FooBarBaz'
 * pathToPascalName('foo/index.ts')     // -> 'Foo'
 * pathToPascalName('HTML/parser.ts')   // -> 'HTMLParser'
 * pathToPascalName('parser/HTML.ts')   // -> 'ParserHTML'
 * pathToPascalName('index.ts')         // -> ''
 * pathToPascalName('')                 // -> ''
 * ```
 */
export function pathToPascalName(relativePath: string): string {
  return pathNameSegments(relativePath).map(toPascalCase).join('');
}
