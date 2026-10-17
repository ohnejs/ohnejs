/**
 * Splits a field key into an optional `/`, one `..` per leading `../`, then its dot parts.
 * The segments are what `conditionResolver` reads; an empty part gives `undefined`.
 *
 * @example
 * ```ts
 * parseFieldPath('title')        // -> ['title']
 * parseFieldPath('../seo.title') // -> ['..', 'seo', 'title']
 * parseFieldPath('/kind')        // -> ['/', 'kind']
 * parseFieldPath('seo..title')   // -> undefined
 * parseFieldPath('../')          // -> undefined
 * ```
 */
export function parseFieldPath(key: string): string[] | undefined {
  const segments: string[] = [];
  let rest = key;
  if (rest.startsWith('/')) {
    segments.push('/');
    rest = rest.slice(1);
  }
  while (rest.startsWith('../')) {
    segments.push('..');
    rest = rest.slice(3);
  }
  if (rest === '') return undefined;
  for (const segment of rest.split('.')) {
    if (segment === '') return undefined;
    segments.push(segment);
  }
  return segments;
}
