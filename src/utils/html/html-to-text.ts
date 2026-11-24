import { decodeXMLEntities } from '../xml/decode-xml-entities.ts';

const LATIN1 = [
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg',
  'plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34',
  'iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml',
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave',
  'Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil',
  'egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde',
  'ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml',
]
  .join(' ')
  .split(' ');

const NAMED = new Map(LATIN1.map((name, i) => [name, String.fromCharCode(0xa0 + i)]));

const NAMED_ENTITY = new RegExp(`&(${LATIN1.join('|')});`, 'g');

const DROPPED = /<(script|style|head|svg|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

const BLOCK =
  /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul)\b[^>]*>/gi;

const CELL = /<\/?t[dh]\b[^>]*>/gi;

const TAG = /<[!?/]?[a-zA-Z][^>]*>|<![^>]*>|<\?[^>]*>/g;

/**
 * Extracts the readable text of an HTML page or fragment, line by line, without a DOM.
 * Scripts, styles, `head`, `svg`, `template`, `noscript`, and comments drop out with their content.
 * Block elements such as `p`, `li`, `h1` and `br` break lines, and table cells are spaced apart.
 * Entities decode: numeric ones, the XML ones, and the HTML names from `&nbsp;` to `&yuml;`.
 * Whitespace collapses within each line, and runs of empty lines shrink to one.
 *
 * @example
 * ```ts
 * htmlToText('<h1>Caf&eacute;</h1><p>Mo&ndash;Fr<br>8&#8211;18 Uhr</p><script>x()</script>')
 * // -> 'Café\n\nMo&ndash;Fr\n8–18 Uhr'
 * ```
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(DROPPED, '')
    .replace(/\s+/g, ' ')
    .replace(BLOCK, '\n')
    .replace(CELL, ' ')
    .replace(TAG, '')
    .replace(NAMED_ENTITY, (_, name: string) => NAMED.get(name)!);

  const lines = decodeXMLEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim());
  return lines
    .filter((line, i) => line !== '' || (i > 0 && lines[i - 1] !== ''))
    .join('\n')
    .trim();
}
