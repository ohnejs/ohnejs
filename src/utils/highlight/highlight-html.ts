import { escapeXML } from '../xml/escape-xml.ts';
import { tokenize } from './tokenize.ts';

/**
 * Marks `code` up for a `<pre><code>` element.
 * The text is escaped, and each token is wrapped in a `<span class="tk-<kind>">`.
 * An unknown language comes back as escaped text.
 * Newlines and indentation come through untouched.
 *
 * @example
 * ```ts
 * highlightHTML('a < 1', 'ts')   // -> 'a &lt; <span class="tk-number">1</span>'
 * highlightHTML('a < 1', 'text') // -> 'a &lt; 1'
 * ```
 */
export function highlightHTML(code: string, language: string): string {
  let html = '';
  let at = 0;
  for (const { kind, start, end } of tokenize(code, language)) {
    html += escapeXML(code.slice(at, start));
    html += `<span class="tk-${kind}">${escapeXML(code.slice(start, end))}</span>`;
    at = end;
  }
  return html + escapeXML(code.slice(at));
}
