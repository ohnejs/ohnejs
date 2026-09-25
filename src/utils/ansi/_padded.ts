/**
 * Whether span content starts and ends with a space and holds more than spaces.
 * Such content drops one space per side when printed, as in Markdown.
 *
 * Shared by `codeSpan` and `applyANSIMarkup` so fencing and printing never diverge.
 *
 * @example
 * ```ts
 * isPadded(' `x ') // -> true
 * isPadded('  ')   // -> false
 * isPadded(' x')   // -> false
 * ```
 */
export function isPadded(content: string): boolean {
  return content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content);
}
