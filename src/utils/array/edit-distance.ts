/**
 * The Levenshtein distance between `a` and `b`: the fewest insertions, deletions, and substitutions.
 * It compares items with `===`, so it measures strings by UTF-16 code unit or token arrays by token.
 * Two rolling rows keep the memory at the shorter input's length.
 *
 * @example
 * ```ts
 * editDistance('kitten', 'sitting')                           // -> 3
 * editDistance(['guten', 'tag', 'herr'], ['guten', 'morgen']) // -> 2
 * editDistance('', 'abc')                                     // -> 3
 * ```
 */
export function editDistance<T>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  const [long, short] = a.length < b.length ? [b, a] : [a, b];
  let previous = Uint32Array.from({ length: short.length + 1 }, (_, j) => j);
  let current = new Uint32Array(short.length + 1);

  for (let i = 1; i <= long.length; i++) {
    current[0] = i;
    for (let j = 1; j <= short.length; j++) {
      const substitute = previous[j - 1] + (long[i - 1] === short[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitute);
    }
    [previous, current] = [current, previous];
  }

  return previous[short.length];
}
