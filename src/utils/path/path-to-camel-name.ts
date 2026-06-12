import { toCamelCase } from '../case/to-camel-case.ts';
import { toPascalCase } from '../case/to-pascal-case.ts';
import { pathNameSegments } from './path-name-segments.ts';

/**
 * Derives a `camelCase` name from a relative path.
 * The first segment is camelCased, the rest PascalCased.
 * A leading acronym is lowercased entirely; trailing acronyms survive.
 * A trailing `index` segment collapses into its parent.
 *
 * Returns `''` when the path resolves to no segments.
 *
 * @example
 * ```ts
 * pathToCamelName('foo/bar-baz.ts')    // -> 'fooBarBaz'
 * pathToCamelName('foo/index.ts')      // -> 'foo'
 * pathToCamelName('HTML/content.ts')   // -> 'htmlContent'
 * pathToCamelName('content/HTML.ts')   // -> 'contentHTML'
 * pathToCamelName('foo/BAR.ts')        // -> 'fooBAR'
 * pathToCamelName('index.ts')          // -> ''
 * pathToCamelName('')                  // -> ''
 * ```
 */
export function pathToCamelName(relativePath: string): string {
  const segments = pathNameSegments(relativePath);
  if (segments.length === 0) return '';
  const [first, ...rest] = segments;
  return toCamelCase(first!) + rest.map(toPascalCase).join('');
}
