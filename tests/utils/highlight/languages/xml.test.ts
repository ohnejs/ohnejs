import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeXML } from '../../../../src/utils/highlight/languages/xml.ts';

const spans = (code: string) => tokenizeXML(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeXML', () => {
  it('classifies tags, attributes and values', () => {
    deepStrictEqual(spans(`<a x="1" y='2'>t</a>`), [
      ['tag', '<a'],
      ['attribute', 'x'],
      ['string', '"1"'],
      ['attribute', 'y'],
      ['string', "'2'"],
      ['tag', '>'],
      ['tag', '</a'],
      ['tag', '>'],
    ]);
  });

  it('classifies a self-closing tag with spaced `=`', () => {
    deepStrictEqual(spans('<br clear = "all" />'), [
      ['tag', '<br'],
      ['attribute', 'clear'],
      ['string', '"all"'],
      ['tag', '/>'],
    ]);
  });

  it('keeps a namespace prefix in the name', () => {
    deepStrictEqual(spans('<xsl:value-of select="." xmlns:xsl="u"/>'), [
      ['tag', '<xsl:value-of'],
      ['attribute', 'select'],
      ['string', '"."'],
      ['attribute', 'xmlns:xsl'],
      ['string', '"u"'],
      ['tag', '/>'],
    ]);
  });

  it('classifies comments', () => {
    deepStrictEqual(spans('<!-- a <b> -->'), [['comment', '<!-- a <b> -->']]);
  });

  it('classifies a CDATA section as a string', () => {
    deepStrictEqual(spans('<s><![CDATA[a < b]]></s>'), [
      ['tag', '<s'],
      ['tag', '>'],
      ['string', '<![CDATA[a < b]]>'],
      ['tag', '</s'],
      ['tag', '>'],
    ]);
  });

  it('classifies a processing instruction as a keyword', () => {
    deepStrictEqual(spans('<?xml version="1.0" encoding="UTF-8"?>\n<r/>'), [
      ['keyword', '<?xml version="1.0" encoding="UTF-8"?>'],
      ['tag', '<r'],
      ['tag', '/>'],
    ]);
  });

  it('classifies a doctype and the declarations of its internal subset', () => {
    deepStrictEqual(spans('<!DOCTYPE r [\n<!ENTITY e "v">\n]>\n<r/>'), [
      ['keyword', '<!DOCTYPE r '],
      ['keyword', '<!ENTITY e "v">'],
      ['tag', '<r'],
      ['tag', '/>'],
    ]);
  });

  it('classifies a public doctype', () => {
    deepStrictEqual(spans('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">'), [
      ['keyword', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">'],
    ]);
  });

  it('classifies named and numeric entities as variables', () => {
    deepStrictEqual(spans('a &amp; &#65; &#x41; &x.y-z;'), [
      ['variable', '&amp;'],
      ['variable', '&#65;'],
      ['variable', '&#x41;'],
      ['variable', '&x.y-z;'],
    ]);
  });

  it('leaves a bare ampersand plain', () => {
    deepStrictEqual(spans('a & b &c d'), []);
  });

  it('keeps an entity inside a value as part of the string', () => {
    deepStrictEqual(spans('<a href="?a=1&amp;b=2">'), [
      ['tag', '<a'],
      ['attribute', 'href'],
      ['string', '"?a=1&amp;b=2"'],
      ['tag', '>'],
    ]);
  });

  it('leaves text, quotes and `>` outside a tag plain', () => {
    deepStrictEqual(spans(`<p>x > y "z" it's a=b</p>`), [
      ['tag', '<p'],
      ['tag', '>'],
      ['tag', '</p'],
      ['tag', '>'],
    ]);
  });

  it('carries a value across lines', () => {
    deepStrictEqual(spans('<path d="M0 0\n  L10 10"/>'), [
      ['tag', '<path'],
      ['attribute', 'd'],
      ['string', '"M0 0\n  L10 10"'],
      ['tag', '/>'],
    ]);
  });

  it('ends an unterminated value before the next tag', () => {
    deepStrictEqual(spans('<a x="open\n<b>'), [
      ['tag', '<a'],
      ['attribute', 'x'],
      ['string', '"open\n'],
      ['tag', '<b'],
      ['tag', '>'],
    ]);
  });

  it('runs an unterminated comment, CDATA or instruction to the end', () => {
    deepStrictEqual(spans('<!-- a\n<b>'), [['comment', '<!-- a\n<b>']]);
    deepStrictEqual(spans('<![CDATA[ a\n<b>'), [['string', '<![CDATA[ a\n<b>']]);
    deepStrictEqual(spans('<?pi a\n<b>'), [['keyword', '<?pi a\n<b>']]);
  });

  it('ends an unterminated declaration before the next tag', () => {
    deepStrictEqual(spans('<!DOCTYPE html\n<r/>'), [
      ['keyword', '<!DOCTYPE html\n'],
      ['tag', '<r'],
      ['tag', '/>'],
    ]);
  });

  it('closes an unclosed tag at the next markup', () => {
    deepStrictEqual(spans('<a b <!-- c --> d'), [
      ['tag', '<a'],
      ['attribute', 'b'],
      ['comment', '<!-- c -->'],
    ]);
  });

  it('leaves a `<` that opens no name plain', () => {
    deepStrictEqual(spans('a < 3 <1'), []);
  });

  it('highlights an SVG document', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
      '  <style>.a { fill: red }</style>',
      '  <circle class="a" cx="12" cy="12" r="10"/>',
      '</svg>',
    ].join('\n');
    deepStrictEqual(spans(svg), [
      ['tag', '<svg'],
      ['attribute', 'xmlns'],
      ['string', '"http://www.w3.org/2000/svg"'],
      ['attribute', 'viewBox'],
      ['string', '"0 0 24 24"'],
      ['tag', '>'],
      ['tag', '<style'],
      ['tag', '>'],
      ['tag', '</style'],
      ['tag', '>'],
      ['tag', '<circle'],
      ['attribute', 'class'],
      ['string', '"a"'],
      ['attribute', 'cx'],
      ['string', '"12"'],
      ['attribute', 'cy'],
      ['string', '"12"'],
      ['attribute', 'r'],
      ['string', '"10"'],
      ['tag', '/>'],
      ['tag', '</svg'],
      ['tag', '>'],
    ]);
  });

  it('starts every call outside a tag', () => {
    tokenizeXML('<a');
    deepStrictEqual(spans('b>'), []);
  });

  it('stays linear on adversarial input', () => {
    for (const unit of ['<a x="', '<!--', '<![CDATA[', '<?', '<!D', '<a ', '="', '&a', '<', '"']) {
      const code = unit.repeat(Math.ceil(1_000_000 / unit.length));
      const started = performance.now();
      const tokens = tokenizeXML(code);
      ok(performance.now() - started < 1000, unit);
      let end = 0;
      for (const token of tokens) {
        ok(token.start >= end && token.end > token.start && token.end <= code.length, unit);
        end = token.end;
      }
    }
  });
});
