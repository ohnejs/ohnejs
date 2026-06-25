/**
 * Appends field names to a `Vary` header value, case-insensitively deduplicated.
 * Pass the current header (or `''`) and the fields to add; the merged value is returned.
 * A `*` anywhere collapses the result to `*`, since that already varies by everything.
 *
 * The first-seen casing and order of each field are kept.
 * Fields may themselves be comma-separated; each token is split out and trimmed.
 *
 * @example
 * ```ts
 * vary('', 'Accept')                // -> 'Accept'
 * vary('Accept-Encoding', 'accept') // -> 'Accept-Encoding, accept'
 * vary('Accept', 'Accept')          // -> 'Accept'
 * vary('Accept', '*')               // -> '*'
 * ```
 */
export function vary(header: string, ...fields: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of [header, ...fields]) {
    for (const token of part.split(',')) {
      const field = token.trim();
      if (field === '') continue;
      if (field === '*') return '*';

      const key = field.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(field);
    }
  }

  return result.join(', ');
}
