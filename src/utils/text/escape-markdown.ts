const PUNCTUATION = /[!-/:-@[-`{-~]/g;

/**
 * Escapes every ASCII punctuation mark in `text` with a backslash, so markdown reads it as plain text.
 * Interpolate it into a link label or an emphasis, where a `]` or `*` of its own would end the span.
 *
 * @example
 * ```ts
 * escapeMarkdown('Blog [old]') // -> 'Blog \\[old\\]'
 * escapeMarkdown('*draft*')    // -> '\\*draft\\*'
 * escapeMarkdown('Über uns')   // -> 'Über uns'
 * ```
 */
export function escapeMarkdown(text: string): string {
  return text.replace(PUNCTUATION, '\\$&');
}
