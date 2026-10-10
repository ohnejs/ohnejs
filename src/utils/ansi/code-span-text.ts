import { isPadded } from './_padded.ts';

/**
 * The text a whole code `span` shows: its content between the fences.
 * Content padded on both sides drops one space per side, as in Markdown.
 * That padding lets `codeSpan` fence a value that starts or ends with a backtick.
 *
 * @example
 * ```ts
 * codeSpanText('`` `x ``') // -> '`x'
 * codeSpanText('`  `')     // -> '  '
 * codeSpanText('`a`')      // -> 'a'
 * ```
 */
export function codeSpanText(span: string): string {
  const fence = /^`+/.exec(span)![0].length;
  const content = span.slice(fence, -fence);
  return isPadded(content) ? content.slice(1, -1) : content;
}
