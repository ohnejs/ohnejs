import { deepStrictEqual, doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSVG, sanitizeSVG } from '../../../src/utils/html/sanitize-svg.ts';

describe('isSVG', () => {
  it('detects an svg root', () => {
    strictEqual(isSVG('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), true);
    strictEqual(isSVG('<svg/>'), true);
    strictEqual(isSVG('<svg/>'.padStart(10, ' ')), true);
  });

  it('tolerates a BOM, an XML declaration, comments, and a DOCTYPE ahead of the root', () => {
    const prologue =
      '\uFEFF<?xml version="1.0"?>\n<!-- generator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">\n';
    strictEqual(isSVG(`${prologue}<svg></svg>`), true);
  });

  it('looks through a prologue larger than 1 KiB', () => {
    strictEqual(isSVG(`<!--${' '.repeat(2000)}-->\n<svg><rect/></svg>`), true);
  });

  it('stops looking after 16 KiB', () => {
    strictEqual(isSVG(`${' '.repeat(16 * 1024 - 5)}<svg/>`), true);
    strictEqual(isSVG(`${' '.repeat(16 * 1024)}<svg/>`), false);
  });

  it('rejects other markup and binary data', () => {
    strictEqual(isSVG('<html><body></body></html>'), false);
    strictEqual(isSVG('\x89PNG\r\n\x1a\n'), false);
    strictEqual(isSVG(''), false);
  });

  it('requires a boundary after the tag name', () => {
    strictEqual(isSVG('<svgfake></svgfake>'), false);
  });
});

describe('sanitizeSVG', () => {
  it('returns an empty result for input without an svg element', () => {
    deepStrictEqual(sanitizeSVG('<html></html>'), { svg: '', removed: [] });
    deepStrictEqual(sanitizeSVG('<!-- <svg> -->'), { svg: '', removed: [] });
  });

  it('keeps a clean svg untouched', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    deepStrictEqual(sanitizeSVG(input), { svg: input, removed: [] });
  });

  it('strips script elements, paired and self-closing, in any casing', () => {
    const paired = sanitizeSVG('<svg><script>alert(1)</script><circle/></svg>');
    doesNotMatch(paired.svg, /script/i);
    ok(paired.svg.includes('<circle'));
    deepStrictEqual(paired.removed, ['script']);

    doesNotMatch(sanitizeSVG('<svg><script src="evil.js"/></svg>').svg, /script/i);
    doesNotMatch(
      sanitizeSVG('<svg><ScRiPt type="text/javascript">payload</ScRiPt></svg>').svg,
      /script/i,
    );
    doesNotMatch(sanitizeSVG('<svg><script data-x=">">alert(1)</script></svg>').svg, /alert/);
  });

  it('strips prefixed script elements', () => {
    const input =
      '<svg xmlns:xhtml="http://www.w3.org/1999/xhtml"><xhtml:script>alert(1)</xhtml:script></svg>';
    const { svg, removed } = sanitizeSVG(input);
    doesNotMatch(svg, /script/i);
    deepStrictEqual(removed, ['script']);
    doesNotMatch(sanitizeSVG('<svg><svg:script>alert(1)</svg:script></svg>').svg, /script/i);
  });

  it('strips on* event handler attributes regardless of quote style', () => {
    const { svg, removed } = sanitizeSVG(
      `<svg onload="alert(1)"><a onclick='x()' onerror=alert(2) href="#">hi</a></svg>`,
    );
    doesNotMatch(svg, /onload|onclick|onerror/i);
    ok(svg.includes('href="#"'));
    deepStrictEqual(removed, ['on*']);
  });

  it('strips foreignObject with its contents', () => {
    const { svg, removed } = sanitizeSVG(
      '<svg><foreignObject><iframe src="x"></iframe></foreignObject></svg>',
    );
    doesNotMatch(svg, /foreignObject|iframe/i);
    deepStrictEqual(removed, ['foreignobject']);
  });

  it('strips SMIL animation elements', () => {
    const animate = sanitizeSVG(
      '<svg><a href="?"><animate attributeName="href" values="javascript:alert(1)" begin="0"/></a></svg>',
    );
    doesNotMatch(animate.svg, /animate/i);
    deepStrictEqual(animate.removed, ['animate']);

    const color = sanitizeSVG(
      '<svg><animateColor attributeName="x" values="javascript:alert(1)"/></svg>',
    );
    doesNotMatch(color.svg, /animateColor/i);
    deepStrictEqual(color.removed, ['animatecolor']);

    doesNotMatch(sanitizeSVG('<svg><set attributeName="href" to="x"/></svg>').svg, /<set/i);
    ok(sanitizeSVG('<svg><settings/></svg>').svg.includes('<settings/>'));
  });

  it('strips meta elements', () => {
    const { svg, removed } = sanitizeSVG(
      '<svg><meta http-equiv="refresh" content="0;url=https://example.com"/></svg>',
    );
    strictEqual(svg, '<svg></svg>');
    deepStrictEqual(removed, ['meta']);
  });

  it('strips href values using the javascript: scheme', () => {
    const plain = sanitizeSVG('<svg><a href="javascript:alert(1)">x</a></svg>');
    doesNotMatch(plain.svg, /javascript:/i);
    deepStrictEqual(plain.removed, ['href']);

    const prefixed = sanitizeSVG('<svg><use xlink:href="javascript:alert(1)"/></svg>');
    doesNotMatch(prefixed.svg, /javascript:/i);
    deepStrictEqual(prefixed.removed, ['xlink:href']);
  });

  it('decodes character references before checking the scheme', () => {
    doesNotMatch(
      sanitizeSVG('<svg><a href="&#106;avascript:alert(1)">x</a></svg>').svg,
      /javascript:|&#106;avascript:/i,
    );
    doesNotMatch(
      sanitizeSVG('<svg><a href="&#x6A;avascript:alert(1)">x</a></svg>').svg,
      /avascript/i,
    );
    doesNotMatch(sanitizeSVG('<svg><a href="javascript&colon;alert(1)">x</a></svg>').svg, /alert/);
  });

  it('ignores tabs, newlines, and control characters inside a scheme', () => {
    doesNotMatch(sanitizeSVG('<svg><a href="java&#9;script:alert(1)">x</a></svg>').svg, /alert/);
    doesNotMatch(sanitizeSVG('<svg><a href="java\nscript:alert(1)">x</a></svg>').svg, /alert/);
    doesNotMatch(sanitizeSVG('<svg><a href="\x01javascript:alert(1)">x</a></svg>').svg, /alert/);
    doesNotMatch(sanitizeSVG('<svg><a href="  JAVASCRIPT:alert(1)">x</a></svg>').svg, /alert/);
  });

  it('strips data: URIs except raster images', () => {
    const dropped = sanitizeSVG(
      '<svg><image href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="/></svg>',
    );
    ok(!dropped.svg.includes('data:text/html'));

    const kept = sanitizeSVG('<svg><image href="data:image/png;base64,AAA"/></svg>');
    ok(kept.svg.includes('data:image/png'));
    deepStrictEqual(kept.removed, []);
  });

  it('blocks nested data:image/svg+xml URIs', () => {
    const { svg, removed } = sanitizeSVG(
      '<svg><image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PjwvL3NjcmlwdD48L3N2Zz4="/></svg>',
    );
    ok(!svg.includes('data:image/svg+xml'));
    deepStrictEqual(removed, ['href']);
  });

  it('blocks external references, scheme-relative ones included', () => {
    const absolute = sanitizeSVG('<svg><use href="https://example.com/x.svg#x"/></svg>');
    ok(!absolute.svg.includes('example.com'));
    deepStrictEqual(absolute.removed, ['href']);

    ok(!sanitizeSVG('<svg><use href="//example.com/x.svg#x"/></svg>').svg.includes('example.com'));
    ok(
      !sanitizeSVG('<svg><use href="\\\\example.com/x.svg#x"/></svg>').svg.includes('example.com'),
    );
    ok(
      !sanitizeSVG('<svg><image src="ftp://example.com/x.png"/></svg>').svg.includes('example.com'),
    );
  });

  it('allows in-document fragments and relative paths', () => {
    const input =
      '<svg><defs><circle id="c" r="5"/></defs><use href="#c"/><image href="a.png"/></svg>';
    deepStrictEqual(sanitizeSVG(input), { svg: input, removed: [] });
  });

  it('treats xml:base like any other URL attribute', () => {
    const { svg, removed } = sanitizeSVG(
      '<svg xml:base="https://example.com/"><use href="x.svg#a"/></svg>',
    );
    ok(!svg.includes('example.com'));
    deepStrictEqual(removed, ['xml:base']);
    ok(sanitizeSVG('<svg xml:base="./icons/"/>').svg.includes('xml:base="./icons/"'));
  });

  it('removes style elements with expression(), @import, or external url()', () => {
    const expression = sanitizeSVG(
      '<svg><style>rect { width: expression(alert(1)); }</style><rect/></svg>',
    );
    doesNotMatch(expression.svg, /<style|expression/i);
    deepStrictEqual(expression.removed, ['style']);

    doesNotMatch(
      sanitizeSVG('<svg><style>@import url("https://example.com/x.css");</style><rect/></svg>').svg,
      /<style/i,
    );
    doesNotMatch(
      sanitizeSVG('<svg><style>rect { fill: url(https://example.com/x.svg#g); }</style></svg>').svg,
      /<style/i,
    );
  });

  it('removes style elements that fetch through image-set() or an svg data: URI', () => {
    doesNotMatch(
      sanitizeSVG(
        '<svg><style>rect { mask-image: image-set("https://example.com/m.png" 1x); }</style></svg>',
      ).svg,
      /<style/i,
    );
    doesNotMatch(
      sanitizeSVG('<svg><style>rect { fill: url(data:image/svg+xml;base64,AAA); }</style></svg>')
        .svg,
      /<style/i,
    );
  });

  it('keeps style elements with safe url() references', () => {
    const input = '<svg><style>rect { fill: url(#gradient); }</style><rect/></svg>';
    deepStrictEqual(sanitizeSVG(input), { svg: input, removed: [] });
    ok(
      sanitizeSVG(
        '<svg><style>.a { fill: url("data:image/png;base64,AAA") }</style></svg>',
      ).svg.includes('<style>'),
    );
  });

  it('sees through CSS escapes', () => {
    doesNotMatch(
      sanitizeSVG('<svg><style>rect { fill: \\75rl(https://example.com/x.svg#g); }</style></svg>')
        .svg,
      /<style/i,
    );
    doesNotMatch(
      sanitizeSVG('<svg><style>@\\69mport "https://example.com/x.css";</style></svg>').svg,
      /<style/i,
    );
    doesNotMatch(
      sanitizeSVG('<svg><rect style="fill: \\75rl(https://example.com/x)"/></svg>').svg,
      /style/i,
    );
  });

  it('removes prefixed and unclosed style elements when their CSS is dangerous', () => {
    doesNotMatch(
      sanitizeSVG('<svg><svg:style>@import url(https://example.com/x.css);</svg:style></svg>').svg,
      /<svg:style|@import/i,
    );
    const unclosed = sanitizeSVG('<svg><style>@import url(https://example.com/x.css);</svg>');
    doesNotMatch(unclosed.svg, /<style|@import/i);
    deepStrictEqual(unclosed.removed, ['style']);
  });

  it('removes inline style attributes with dangerous CSS', () => {
    const { svg, removed } = sanitizeSVG('<svg><rect style="behavior: url(#x)" fill="red"/></svg>');
    doesNotMatch(svg, /behavior/i);
    ok(svg.includes('fill="red"'));
    deepStrictEqual(removed, ['style-attr']);
  });

  it('blocks external url() on presentation attributes', () => {
    const filter = sanitizeSVG('<svg><rect filter="url(https://example.com/x.svg#f)"/></svg>');
    ok(!filter.svg.includes('example.com'));
    deepStrictEqual(filter.removed, ['filter']);
    ok(
      !sanitizeSVG('<svg><rect mask="url(https://example.com/x.svg#m)"/></svg>').svg.includes(
        'example.com',
      ),
    );
  });

  it('keeps in-document url() references on presentation attributes', () => {
    const input = '<svg><rect filter="url(#blur)" mask="url(#m)" fill="url(#g)"/></svg>';
    deepStrictEqual(sanitizeSVG(input), { svg: input, removed: [] });
  });

  it('strips XML processing instructions before the root', () => {
    const { svg, removed } = sanitizeSVG(
      '<?xml version="1.0"?>\n<?xml-stylesheet href="evil.xsl" type="text/xsl"?>\n<svg><rect/></svg>',
    );
    strictEqual(svg, '<svg><rect/></svg>');
    deepStrictEqual(removed, ['xml-stylesheet']);
  });

  it('strips DOCTYPE and ENTITY declarations', () => {
    const { svg, removed } = sanitizeSVG(
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<svg><text>&xxe;</text></svg>',
    );
    ok(svg.startsWith('<svg'));
    doesNotMatch(svg, /DOCTYPE|ENTITY/i);
    deepStrictEqual(removed, ['doctype', 'entity']);
  });

  it('strips markup after the closing tag', () => {
    strictEqual(
      sanitizeSVG('<svg><rect/></svg><script>alert(1)</script>').svg,
      '<svg><rect/></svg>',
    );
  });

  it('strips comments, unterminated ones included', () => {
    const { svg, removed } = sanitizeSVG('<svg><!-- <script>alert(1)</script> --><rect/></svg>');
    strictEqual(svg, '<svg><rect/></svg>');
    deepStrictEqual(removed, ['comment']);
    strictEqual(sanitizeSVG('<svg><rect/><!--<script>alert(1)</script>').svg, '<svg><rect/>');
  });

  it('locates the root outside comments', () => {
    strictEqual(sanitizeSVG('<!-- <svg> --><svg><rect/></svg>').svg, '<svg><rect/></svg>');
    const input = `<!--${' '.repeat(2000)}-->\n<svg><rect/></svg>`;
    strictEqual(sanitizeSVG(input).svg, '<svg><rect/></svg>');
  });

  it('unwraps CDATA so its contents are sanitized as markup', () => {
    const { svg, removed } = sanitizeSVG('<svg><![CDATA[<script>alert(1)</script>]]></svg>');
    doesNotMatch(svg, /script|CDATA/i);
    deepStrictEqual(removed, ['cdata', 'script']);
    strictEqual(sanitizeSVG('<svg><![CDATA[</svg>]]><script>x</script></svg>').svg, '<svg></svg>');
  });

  it('preserves the self-closing slash', () => {
    const { svg } = sanitizeSVG('<svg><circle cx="5" cy="5" r="4" onclick="x()"/></svg>');
    match(svg, /<circle [^>]*\/>/);
    doesNotMatch(svg, /onclick/i);
    strictEqual(sanitizeSVG('<svg><rect onclick="x()"/></svg>').svg, '<svg><rect/></svg>');
  });

  it('scrubs attributes on every element, whatever its name', () => {
    doesNotMatch(
      sanitizeSVG('<svg><_x onload="alert(1)"/><ü onload="alert(1)"/></svg>').svg,
      /onload/i,
    );
    strictEqual(
      sanitizeSVG('<svg><svg:rect onload="x" fill="red"/></svg>').svg,
      '<svg><svg:rect fill="red"/></svg>',
    );
  });

  it('drops attributes it cannot parse rather than passing them through', () => {
    strictEqual(
      sanitizeSVG('<svg><rect x="1"onload="alert(1)"/></svg>').svg,
      '<svg><rect x="1"/></svg>',
    );
  });

  it('dedupes and sorts the removed list', () => {
    const { removed } = sanitizeSVG(
      '<svg onload="x" onclick="y"><script>1</script><script>2</script><a href="javascript:1"></a></svg>',
    );
    deepStrictEqual(removed, ['href', 'on*', 'script']);
  });
});
