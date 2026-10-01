/**
 * Folds text for a case-insensitive comparison.
 * The full fold lowercases every script and reads a final `ς` as `σ`, so a word's end never changes a match.
 * With `asciiOnly`, only `A` to `Z` fold, as SQLite's plain `LIKE` does.
 *
 * @example
 * ```ts
 * foldCase('Émile')               // -> 'émile'
 * foldCase('ΣΟΦΙΑΣ')              // -> 'σοφιασ'
 * foldCase('KELVIN K', true) // -> 'kelvin K'
 * ```
 */
export function foldCase(text: string, asciiOnly = false): string {
  if (asciiOnly) return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  return text.toLowerCase().replaceAll('ς', 'σ');
}
