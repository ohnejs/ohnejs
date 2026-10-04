import { foldCase } from '../case/fold-case.ts';

const MAX_TOKENS = 10;

const MAX_TOKEN_BYTES = 256;

const EDGES = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

const PARTS = /(?<=^|\s)"([^"]*)"(?=\s|$)|\S+/gu;

const encoder = new TextEncoder();

/**
 * Splits a search query into the tokens a match must hold.
 * The query is NFC-normalized, then split on whitespace.
 * A double-quoted run that opens at a word's start and closes at a word's end is one token.
 * Its inner whitespace collapses, and a `"` anywhere else is a plain character.
 * Each token loses its leading and trailing punctuation and symbols, while inner ones stay: `sea.jpg`, `q-3`.
 * A one-character ASCII token drops, a lone non-ASCII character like `東` stays.
 * A token that folds to nothing, like a lone combining mark, drops.
 * A token over 256 UTF-8 bytes drops.
 * Duplicates drop ignoring case and accents, keeping the first, and only the first ten tokens count.
 *
 * @example
 * ```ts
 * searchTokens('Mira "new  york"')     // -> ['Mira', 'new york']
 * searchTokens('(sea.jpg), a é')       // -> ['sea.jpg', 'é']
 * searchTokens('Café cafe CAFE.')      // -> ['Café']
 * searchTokens('o"neil "new york ."')  // -> ['o"neil', 'new york']
 * ```
 */
export function searchTokens(q: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const [word, phrase] of q.normalize('NFC').matchAll(PARTS)) {
    const token = (phrase ?? word).replace(/\s+/gu, ' ').trim().replace(EDGES, '').trim();
    const key = foldCase(token);
    if (key === '' || seen.has(key) || encoder.encode(token).length > MAX_TOKEN_BYTES) continue;
    if (token.length === 1 && token.charCodeAt(0) < 0x80) continue;
    seen.add(key);
    tokens.push(token);
    if (tokens.length === MAX_TOKENS) break;
  }
  return tokens;
}
