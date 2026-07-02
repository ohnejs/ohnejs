/**
 * Returns a message key's group: its first dot-separated segment.
 * The group is how the catalog endpoint partitions keys, so `field.minLength` lives in `field`.
 * A key with no dot is its own group.
 *
 * @example
 * ```ts
 * messageGroup('field.minLength')   // -> 'field'
 * messageGroup('api.http.notFound') // -> 'api'
 * messageGroup('greeting')          // -> 'greeting'
 * ```
 */
export function messageGroup(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}
