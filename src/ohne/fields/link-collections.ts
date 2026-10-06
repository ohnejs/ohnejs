import { literalUnion } from '../../utils/codegen/index.ts';
import { isBoolean } from '../../utils/index.ts';
import { useCollections } from '../collections/use-collections.ts';

/**
 * Narrows a `links` option to the collections that are registered.
 * A record link into an unregistered collection then fails as a link into a collection the option omits.
 *
 * @example
 * ```ts
 * registeredLinks(true)                // -> true
 * registeredLinks(['Pages', 'Ghosts']) // -> ['Pages']
 * ```
 */
export function registeredLinks(links: boolean | readonly string[]): boolean | readonly string[] {
  return isBoolean(links) ? links : links.filter((name) => useCollections().has(name));
}

/**
 * The type parameter of a link-bearing value type: the union of the collections `links` names.
 * Without a collection list, the parameter is `never`, so a record link never typechecks.
 *
 * @example
 * ```ts
 * linksParameter(['Pages', 'Posts']) // -> "'Pages' | 'Posts'"
 * linksParameter(true)               // -> 'never'
 * ```
 */
export function linksParameter(links: boolean | readonly string[]): string {
  return literalUnion(isBoolean(links) ? [] : [...links]);
}
