/**
 * A successful fuzzy match of a needle against a haystack.
 */
export interface FuzzyMatch {
  /**
   * The match quality, where higher is better.
   * Only comparable across results from the same `needle`; never read it as an absolute.
   */
  score: number;

  /**
   * The matched character indices into the haystack, in ascending order.
   * Empty when the needle is empty.
   */
  positions: number[];
}

const MATCH = 16;
const BOUNDARY = 8;
const CONSECUTIVE = 8;
const CASE = 1;
const GAP = 1;
const UPPER = /\p{Lu}/u;
const NUMBER = /\p{N}/u;

/**
 * Scores `needle` against `haystack` as a subsequence, the way an editor's "go to file" search does.
 * Returns the best-scoring alignment, or `null` when `needle` is not a subsequence of `haystack`.
 * Matching is case-insensitive; an exact-case hit scores a touch higher.
 *
 * The score rewards word-boundary matches and consecutive runs, and penalizes the gaps between them.
 * A word boundary is the string start, a spot after a separator, a camelCase hump, or a digit after a letter.
 * An empty needle matches everything with score `0` and no positions.
 * `positions` index into `haystack` and can drive highlighting of the matched characters.
 *
 * Operates on UTF-16 code units, which is exact for the ASCII of file names and identifiers.
 *
 * @example
 * ```ts
 * fuzzyMatch('te3', 'test-3')  // -> { score: 72, positions: [0, 1, 5] }
 * fuzzyMatch('ts', 'tools.ts') // -> { score: 44, positions: [6, 7] }
 * fuzzyMatch('xyz', 'test-3')  // -> null
 * fuzzyMatch('', 'test-3')     // -> { score: 0, positions: [] }
 * ```
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (needle === '') return { score: 0, positions: [] };

  const n = needle.length;
  const m = haystack.length;
  if (n > m) return null;

  const score: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    score.push(Array.from({ length: m }, () => -Infinity));
    from.push(Array.from({ length: m }, () => -1));
  }

  for (let j = 0; j <= m - n; j += 1) {
    if (needle[0].toLowerCase() === haystack[j].toLowerCase()) {
      score[0][j] = charScore(needle[0], haystack, j) - j * GAP;
    }
  }

  for (let i = 1; i < n; i += 1) {
    // Gap penalty is linear in k, so the best non-adjacent predecessor reduces to a prefix-max.
    let runBest = -Infinity;
    let runArg = -1;
    for (let j = i; j <= m - (n - i); j += 1) {
      const add = j - 2;
      if (add >= i - 1 && score[i - 1][add] !== -Infinity) {
        const value = score[i - 1][add] + (add + 1) * GAP;
        if (value > runBest) {
          runBest = value;
          runArg = add;
        }
      }
      if (needle[i].toLowerCase() !== haystack[j].toLowerCase()) continue;
      const here = charScore(needle[i], haystack, j);
      let best = -Infinity;
      let bestK = -1;
      if (runArg !== -1) {
        best = here - j * GAP + runBest;
        bestK = runArg;
      }
      const adjacent = score[i - 1][j - 1];
      if (adjacent !== -Infinity && adjacent + here + CONSECUTIVE > best) {
        best = adjacent + here + CONSECUTIVE;
        bestK = j - 1;
      }
      if (bestK === -1) continue;
      score[i][j] = best;
      from[i][j] = bestK;
    }
  }

  let bestScore = -Infinity;
  let end = -1;
  for (let j = n - 1; j < m; j += 1) {
    if (score[n - 1][j] > bestScore) {
      bestScore = score[n - 1][j];
      end = j;
    }
  }
  if (end === -1) return null;

  const positions = Array.from({ length: n }, () => 0);
  for (let i = n - 1, j = end; i >= 0; i -= 1) {
    positions[i] = j;
    j = from[i][j];
  }
  return { score: bestScore, positions };
}

/**
 * The score for matching `char` at `haystack[j]`: the base, plus any word-boundary and exact-case bonus.
 */
function charScore(char: string, haystack: string, j: number): number {
  let score = MATCH;
  if (isBoundary(haystack, j)) score += BOUNDARY;
  if (char === haystack[j]) score += CASE;
  return score;
}

/**
 * Whether `haystack[j]` starts a word: the string start or a spot after a separator.
 * An uppercase letter after any other word character also counts, as does a digit after a letter.
 */
function isBoundary(haystack: string, j: number): boolean {
  if (j === 0) return true;
  const prev = haystack[j - 1];
  if (!isWordChar(prev)) return true;
  const char = haystack[j];
  return (UPPER.test(char) && !UPPER.test(prev)) || (NUMBER.test(char) && !NUMBER.test(prev));
}

/**
 * Whether `char` is a Unicode letter or number; anything else, `_` included, is a separator.
 */
function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}
