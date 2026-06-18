/**
 * Returns the candidate from `candidates` closest to `input` by Damerau-Levenshtein distance.
 * Returns `undefined` if no candidate is within `maxDistance`.
 *
 * Tuned for "did you mean?" hints on short identifiers like command names, flags, or field names.
 * If `input` exactly matches a candidate, it is returned at distance 0.
 * Ties break by candidate iteration order.
 *
 * Operates on UTF-16 code units.
 * Surrogate pairs and combining marks each count as two units, which is fine for ASCII identifiers.
 *
 * @example
 * ```ts
 * didYouMean('Filesy', ['Files', 'Users', 'Posts']) // -> 'Files'
 * didYouMean('Fiels',  ['Files', 'Tags'])           // -> 'Files'
 * didYouMean('zzzz',   ['Files', 'Users'])          // -> undefined
 *
 * didYouMean('Posts', ['Roasts'], 2) // -> 'Roasts'
 * didYouMean('Posts', ['Roasts'], 1) // -> undefined
 * ```
 */
export function didYouMean(
  input: string,
  candidates: Iterable<string>,
  maxDistance = 2,
): string | undefined {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const distance = damerauLevenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 0) break;
    }
  }

  return best;
}

// OSA-variant Damerau-Levenshtein. Three rolling rows because the transposition rule reads two rows above.
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev2 = new Uint32Array(n + 1);
  let prev1 = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);

  for (let j = 0; j <= n; j++) prev1[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const aChar = a[i - 1];
    const aPrev = a[i - 2];
    for (let j = 1; j <= n; j++) {
      const bChar = b[j - 1];
      const cost = aChar === bChar ? 0 : 1;
      let value = Math.min(curr[j - 1] + 1, prev1[j] + 1, prev1[j - 1] + cost);
      if (i > 1 && j > 1 && aChar === b[j - 2] && aPrev === bChar) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      curr[j] = value;
    }
    [prev2, prev1, curr] = [prev1, curr, prev2];
  }

  return prev1[n];
}
