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
// An HTML parser ends the root at `</svg`, whatever follows its name before the `>`.
const SVG_CLOSE = /<\/svg(?=[\s/>])[^>]*>/i;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const TAG = /<([\p{L}_:][\p{L}\p{N}_.:-]*)([^>]*)>/gu;
// The lookbehind starts a match only at a space run's first character, so a run is never rescanned.
const ATTRIBUTE = /(?<!\s)\s+([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>`]+))?/g;
// The CSS runs to the first `<`, which must be its own close tag: markup splits text the browser joins.
const STYLE_ELEMENT = /<((?:[^\s<>/="':]+:)?style)\b[^>]*>([^<]*)(<\/\1\s*>)?/gi;

// `<meta>` escapes to HTML when inlined and can redirect; `<base>` would rebase the host page's links.
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
  'base',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'applet',
  'portal',
];

const FORBIDDEN = new Set(FORBIDDEN_ELEMENTS);

// A space stands in for each removed span, since no tag or attribute name can hold one to rejoin across it.
const SEPARATOR = ' ';

// Any run up to a colon, since an XML prefix may hold dots, digits, and non-ASCII letters.
const NAMESPACE_PREFIX = '(?:[^\\s<>/="\':]+:)?';

const FORBIDDEN_OPEN = new RegExp(
  `<\\s*${NAMESPACE_PREFIX}(${FORBIDDEN_ELEMENTS.join('|')})\\b[^>]*>`,
  'gi',
);

const FORBIDDEN_CLOSE = new Map(
  FORBIDDEN_ELEMENTS.map((name) => [
    name,
    new RegExp(`<\\s*/\\s*${NAMESPACE_PREFIX}${name}\\s*>`, 'gi'),
  ]),
);

// An HTML parser leaves the `<svg>` at each of these, so an inlining page would read the rest as HTML.
const BREAKOUT_ELEMENTS = [
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
];

// Open and close tags alike, since `</p>` and `</br>` break out as well.
const BREAKOUT_TAG = new RegExp(`<\\/?(${BREAKOUT_ELEMENTS.join('|')})(?=[\\s/>])[^>]*>`, 'gi');

// `xml:base` rebases every relative reference in the document.
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'background',
  'poster',
  'data',
  'codebase',
  'xml:base',
]);

// Each lists several URLs, so every one is checked, not the value as one URL.
const URL_LIST_ATTRIBUTES = new Set(['srcset', 'imagesrcset', 'ping']);

const URL_LIST_SEPARATOR = /[\s,]+/;

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
// An HTML parser decodes named references `decodeAttributeValue` does not know, such as `&sol;` into `/`.
const UNDECODED_REFERENCE = /&[a-z\d]+;/i;
// As in `ATTRIBUTE`, the lookbehind keeps a space run inside the value from being rescanned.
const URL_PADDING = /^[\s\p{Cc}]+|(?<![\s\p{Cc}])[\s\p{Cc}]+$/gu;

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
  const url = value.replace(/[\t\n\r]/g, '').replace(URL_PADDING, '');
  if (url === '' || url.startsWith('#')) return true;
  if (SCHEME_RELATIVE.test(url) || UNDECODED_REFERENCE.test(url)) return false;
  return RASTER_DATA_URI.test(url) || !SCHEME.test(url);
}

/**
 * Flags CSS that runs code or reaches outside the document.
 * Escapes are decoded first so `\75rl(` reads as `url(`.
 * Any `&` counts too: XML, HTML, and HTML raw text each read a character reference their own way.
 */
function hasDangerousCSS(css: string): boolean {
  if (css.includes('&')) return true;
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
  if (name === 'srcdoc') return name;
  if (name === 'style') return hasDangerousCSS(value) ? 'style-attr' : undefined;
  if (URL_ATTRIBUTES.has(name) || name.endsWith(':href'))
    return isSafeURL(value) ? undefined : name;
  if (URL_LIST_ATTRIBUTES.has(name)) {
    return value.split(URL_LIST_SEPARATOR).every(isSafeURL) ? undefined : name;
  }
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
 * Replaces each CDATA section with its contents, which the later passes then sanitize as markup.
 * An opener with no `]]>` after it stays, as does everything after it.
 */
function unwrapCDATA(markup: string, removed: Set<string>): string {
  let out = '';
  let kept = 0;
  let open = markup.indexOf(CDATA_OPEN);
  while (open !== -1) {
    const close = markup.indexOf(CDATA_CLOSE, open + CDATA_OPEN.length);
    if (close === -1) break;
    removed.add('cdata');
    out += markup.slice(kept, open) + markup.slice(open + CDATA_OPEN.length, close);
    kept = close + CDATA_CLOSE.length;
    open = markup.indexOf(CDATA_OPEN, kept);
  }
  return out + markup.slice(kept);
}

/**
 * Cuts `markup` at its first `<` after the last `>`, where a tag starts that never ends.
 * Every `<` left then has a `>` after it, so no tag pattern scans to the end in vain.
 */
function withoutDanglingTag(markup: string): string {
  const dangling = markup.indexOf('<', markup.lastIndexOf('>') + 1);
  return dangling === -1 ? markup : markup.slice(0, dangling);
}

/**
 * Removes each forbidden element, from its open tag through the first close tag of the same name.
 * An open tag with no close after it goes alone.
 * A name without a close from some offset on has none further on either, so it is never searched again.
 */
function stripForbidden(markup: string, removed: Set<string>): string {
  const unclosed = new Set<string>();
  let out = '';
  let kept = 0;
  FORBIDDEN_OPEN.lastIndex = 0;
  for (let open = FORBIDDEN_OPEN.exec(markup); open; open = FORBIDDEN_OPEN.exec(markup)) {
    const name = open[1].toLowerCase();
    removed.add(name);
    out += markup.slice(kept, open.index) + SEPARATOR;
    kept = FORBIDDEN_OPEN.lastIndex;
    if (unclosed.has(name)) continue;
    const close = FORBIDDEN_CLOSE.get(name)!;
    close.lastIndex = kept;
    if (close.test(markup)) kept = FORBIDDEN_OPEN.lastIndex = close.lastIndex;
    else unclosed.add(name);
  }
  return out + markup.slice(kept);
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
 * - HTML elements at which an HTML parser leaves the `<svg>` (`<p>`, `<img>`, `<font>`, ...), in any casing.
 *   An uploaded graphic holds no HTML, and past one of them an inlining page would read the rest as HTML.
 * - Every `on*` event handler attribute, and every `srcdoc`, which runs a whole HTML document.
 * - URL attributes (`href`, `xlink:href`, `src`, `xml:base`, ...) that leave the document.
 *   Kept: an empty value, a `#fragment`, a relative path, or a raster `data:image/*` URI.
 *   Gone: any other scheme (`javascript:`, `data:text/html`, `blob:`, `https:`, ...) and `//host` targets.
 *   Gone too: a named reference only an HTML parser decodes, such as `&sol;` for `/`.
 * - `<style>` elements and `style` attributes with `expression(`, `behavior:`, `-moz-binding:`, `@import`.
 *   Likewise a `url()` or `image-set()` pointing outside the document; CSS escapes hide neither.
 *   So does CSS holding markup or a character reference, which XML and HTML each read their own way.
 * - An outside `url()` on `fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-*`, and `cursor`.
 * - Everything before `<svg>` and after `</svg>`, where `<?xml-stylesheet?>` and `<!DOCTYPE>` entities live.
 * - Comments, and CDATA wrappers, whose contents are then sanitized as markup.
 *
 * Also gone, unnamed in `removed`: a tag left open at the very end.
 *
 * Text in, text out: decode uploaded bytes with `decodeText` first.
 * An input without an `<svg>` element yields `''` and nothing removed.
 * Every pass runs in time linear in the input, however the markup is crafted.
 *
 * @example
 * ```ts
 * sanitizeSVG('<svg onload="alert(1)"><script>x</script><rect/></svg>')
 * // -> { svg: '<svg> <rect/></svg>', removed: ['on*', 'script'] }
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
  // A tag still open at the end would take its closing `>` from whatever follows the markup inline.
  out = withoutDanglingTag(unwrapCDATA(out, removed));

  const open = out.search(SVG_OPEN);
  if (open === -1) return { svg: '', removed: [] };

  const prologue = out.slice(0, open);
  if (/<\?xml-stylesheet/i.test(prologue)) removed.add('xml-stylesheet');
  if (/<!DOCTYPE/i.test(prologue)) removed.add('doctype');
  if (/<!ENTITY/i.test(prologue)) removed.add('entity');
  out = out.slice(open);

  const close = SVG_CLOSE.exec(out);
  if (close) out = out.slice(0, close.index + close[0].length);

  // A removed element can take the `>` an unfinished tag before it borrowed, leaving that tag open again.
  out = withoutDanglingTag(stripForbidden(out, removed));
  out = withoutDanglingTag(
    out.replace(STYLE_ELEMENT, (match, _, css: string, close: string | undefined) => {
      if (!isUndefined(close) && !hasDangerousCSS(css)) return match;
      removed.add('style');
      return SEPARATOR;
    }),
  );
  out = withoutDanglingTag(
    out.replace(BREAKOUT_TAG, (_, name: string) => {
      removed.add(name.toLowerCase());
      return SEPARATOR;
    }),
  );
  out = out.replace(TAG, (_, name: string, attrs: string) => {
    const local = name.slice(name.lastIndexOf(':') + 1).toLowerCase();
    if (!FORBIDDEN.has(local)) return `<${name}${scrubAttributes(attrs, removed)}>`;
    removed.add(local);
    return SEPARATOR;
  });

  return { svg: out, removed: [...removed].sort() };
}
