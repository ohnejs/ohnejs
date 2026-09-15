import { isUndefined } from '../is/is-undefined.ts';

/**
 * The outcome of `sanitizeSVG`.
 */
export interface SanitizedSVG {
  /**
   * The sanitized markup, cut to the `<svg>` root: nothing before it, nothing after its closing tag.
   * `''` when the input has no `<svg>` element.
   */
  svg: string;

  /**
   * Sorted, deduplicated names of the constructs that were stripped.
   * Elements and attributes appear by their lowercased name (`'script'`, `'foreignobject'`, `'href'`).
   * Event handlers collapse to `'on*'`; a dropped `style` attribute is `'style-attr'`.
   * Wrappers are `'doctype'`, `'entity'`, `'xml-stylesheet'`, `'comment'`, and `'cdata'`.
   */
  removed: string[];
}

const SNIFF_LIMIT = 16 * 1024;

const SVG_OPEN = /<svg[\s/>]/i;
const SVG_CLOSE = /<\/svg\s*>/i;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const TAG = /<([\p{L}_:][\p{L}\p{N}_.:-]*)([^>]*)>/gu;
const ATTRIBUTE = /\s+([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>`]+))?/g;
const STYLE_ELEMENT = /<(?:[\w-]+:)?style\b[^>]*>([\s\S]*?)(?:<\/(?:[\w-]+:)?style\s*>|$)/gi;

// `<meta>` escapes to HTML when the markup is inlined into a page and can redirect it.
const FORBIDDEN_ELEMENTS = [
  'script',
  'foreignobject',
  'handler',
  'listener',
  'meta',
  'cursor',
  'set',
  'animate',
  'animatetransform',
  'animatemotion',
  'animatecolor',
  'discard',
];

const NAMESPACE_PREFIX = '(?:[\\w-]+:)?';
const FORBIDDEN_OPEN = `<\\s*${NAMESPACE_PREFIX}(${FORBIDDEN_ELEMENTS.join('|')})\\b[^>]*>`;
const FORBIDDEN_CLOSE = `<\\s*/\\s*${NAMESPACE_PREFIX}\\1\\s*>`;
const FORBIDDEN_ELEMENT = new RegExp(`${FORBIDDEN_OPEN}(?:[\\s\\S]*?${FORBIDDEN_CLOSE})?`, 'gi');

// `xml:base` rebases every relative reference in the document.
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'background',
  'poster',
  'data',
  'codebase',
  'xml:base',
]);

const URL_REFERENCE_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'filter',
  'mask',
  'clip-path',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
]);

const RASTER_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|avif);/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SCHEME_RELATIVE = /^[/\\]{2}/;

const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})\s?|(.))/gis;
const CSS_CODE = /expression\s*\(|behavior\s*:|-moz-binding\s*:|@import\b|image-set\s*\(/i;
const CSS_EXTERNAL_URL = /url\s*\(\s*(?!['"]?(?:#|data:image\/(?!svg)))/i;

const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
};

const NAMED_REFERENCE = new RegExp(`&(${Object.keys(NAMED_REFERENCES).join('|')});`, 'gi');

/**
 * Unquotes an attribute value and decodes its character references.
 * An obfuscated scheme such as `&#106;avascript:` then reads as `javascript:` for the checks.
 */
function decodeAttributeValue(raw: string | undefined): string {
  if (isUndefined(raw)) return '';
  const value = raw[0] === '"' || raw[0] === "'" ? raw.slice(1, -1) : raw;
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(NAMED_REFERENCE, (_, name: string) => NAMED_REFERENCES[name.toLowerCase()]);
}

/**
 * Allows an empty value, a fragment, a relative path, or a raster `data:image/*` URI.
 * Tabs and newlines are dropped and control characters trimmed first, as the URL parser does.
 */
function isSafeURL(value: string): boolean {
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[\s\p{Cc}]+|[\s\p{Cc}]+$/gu, '');
  if (url === '' || url.startsWith('#')) return true;
  if (SCHEME_RELATIVE.test(url)) return false;
  return RASTER_DATA_URI.test(url) || !SCHEME.test(url);
}

/**
 * Flags CSS that runs code or reaches outside the document.
 * Escapes are decoded first so `\75rl(` reads as `url(`.
 */
function hasDangerousCSS(css: string): boolean {
  const plain = css.replace(CSS_ESCAPE, (_, hex: string | undefined, char: string) =>
    isUndefined(hex) ? char : String.fromCharCode(parseInt(hex, 16)),
  );
  return CSS_CODE.test(plain) || CSS_EXTERNAL_URL.test(plain);
}

/**
 * The `removed` token for an attribute that must go, or `undefined` when it may stay.
 */
function rejectionOf(name: string, value: string): string | undefined {
  if (name.startsWith('on')) return 'on*';
  if (name === 'style') return hasDangerousCSS(value) ? 'style-attr' : undefined;
  if (URL_ATTRIBUTES.has(name) || name.endsWith(':href'))
    return isSafeURL(value) ? undefined : name;
  if (URL_REFERENCE_ATTRIBUTES.has(name) && hasDangerousCSS(value)) return name;
  return undefined;
}

/**
 * Rebuilds an attribute list from the attributes that pass, in their original spelling.
 * A trailing `/` survives so a self-closing tag stays self-closing.
 */
function scrubAttributes(attrs: string, removed: Set<string>): string {
  let out = '';
  for (const match of attrs.matchAll(ATTRIBUTE)) {
    const name = match[1];
    const raw: string | undefined = match[2];
    const rejection = rejectionOf(name.toLowerCase(), decodeAttributeValue(raw));
    if (!isUndefined(rejection)) removed.add(rejection);
    else out += isUndefined(raw) ? ` ${name}` : ` ${name}=${raw}`;
  }
  return /\/\s*$/.test(attrs) ? `${out}/` : out;
}

/**
 * Sniffs whether `text` is an SVG document: an `<svg` tag within its first 16 Ki characters.
 * A BOM, an XML declaration, comments, and a DOCTYPE ahead of the root are all tolerated.
 * Decode uploaded bytes first; the head of a binary blob simply fails the sniff.
 *
 * @example
 * ```ts
 * isSVG('<?xml version="1.0"?>\n<svg></svg>') // -> true
 * isSVG('<svg/>')                             // -> true
 * isSVG('<html><body></body></html>')         // -> false
 * isSVG('<svgfake></svgfake>')                // -> false
 * ```
 */
export function isSVG(text: string): boolean {
  return SVG_OPEN.test(text.slice(0, SNIFF_LIMIT));
}

/**
 * Strips everything from an SVG that could run code or reach outside the document.
 * The result is safe to serve from its own URL or to inline into a page.
 * It is deliberately aggressive.
 * An uploaded graphic needs no scripting, no event-driven animation, and no remote resources.
 *
 * Removed, each named in `removed`:
 * - `<script>`, `<foreignObject>`, `<handler>`, `<listener>`, `<meta>`, and `<cursor>`.
 * - SMIL animation elements (`<animate>`, `<set>`, `<discard>`, ...), which fire events and retarget `href`.
 *   A namespace prefix (`<xhtml:script>`) hides none of them.
 * - Every `on*` event handler attribute.
 * - URL attributes (`href`, `xlink:href`, `src`, `xml:base`, ...) that leave the document.
 *   Kept: an empty value, a `#fragment`, a relative path, or a raster `data:image/*` URI.
 *   Gone: any other scheme (`javascript:`, `data:text/html`, `blob:`, `https:`, ...) and `//host` targets.
 * - `<style>` elements and `style` attributes with `expression(`, `behavior:`, `-moz-binding:`, `@import`.
 *   Likewise a `url()` or `image-set()` pointing outside the document; CSS escapes hide neither.
 * - An outside `url()` on `fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-*`, and `cursor`.
 * - Everything before `<svg>` and after `</svg>`, where `<?xml-stylesheet?>` and `<!DOCTYPE>` entities live.
 * - Comments, and CDATA wrappers, whose contents are then sanitized as markup.
 *
 * Text in, text out: decode uploaded bytes with `decodeText` first.
 * An input without an `<svg>` element yields `''` and nothing removed.
 *
 * @example
 * ```ts
 * sanitizeSVG('<svg onload="alert(1)"><script>x</script><rect/></svg>')
 * // -> { svg: '<svg><rect/></svg>', removed: ['on*', 'script'] }
 *
 * sanitizeSVG('<svg><use href="#shape"/></svg>')
 * // -> { svg: '<svg><use href="#shape"/></svg>', removed: [] }
 * ```
 */
export function sanitizeSVG(svg: string): SanitizedSVG {
  const removed = new Set<string>();

  let out = svg.replace(COMMENT, () => {
    removed.add('comment');
    return '';
  });
  out = out.replace(CDATA, (_, inner: string) => {
    removed.add('cdata');
    return inner;
  });

  const open = out.search(SVG_OPEN);
  if (open === -1) return { svg: '', removed: [] };

  const prologue = out.slice(0, open);
  if (/<\?xml-stylesheet/i.test(prologue)) removed.add('xml-stylesheet');
  if (/<!DOCTYPE/i.test(prologue)) removed.add('doctype');
  if (/<!ENTITY/i.test(prologue)) removed.add('entity');
  out = out.slice(open);

  const close = SVG_CLOSE.exec(out);
  if (close) out = out.slice(0, close.index + close[0].length);

  out = out.replace(FORBIDDEN_ELEMENT, (_, name: string) => {
    removed.add(name.toLowerCase());
    return '';
  });
  out = out.replace(STYLE_ELEMENT, (match, css: string) => {
    if (!hasDangerousCSS(css)) return match;
    removed.add('style');
    return '';
  });
  out = out.replace(
    TAG,
    (_, name: string, attrs: string) => `<${name}${scrubAttributes(attrs, removed)}>`,
  );

  return { svg: out, removed: [...removed].sort() };
}
