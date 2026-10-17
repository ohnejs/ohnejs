import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeHTML } from '../../../../src/utils/highlight/languages/html.ts';

const spans = (code: string) => tokenizeHTML(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeHTML', () => {
  it('classifies tags, attributes and quoted values', () => {
    deepStrictEqual(spans(`<a href="/" title='t'>x</a>`), [
      ['tag', '<a'],
      ['attribute', 'href'],
      ['string', '"/"'],
      ['attribute', 'title'],
      ['string', "'t'"],
      ['tag', '>'],
      ['tag', '</a'],
      ['tag', '>'],
    ]);
  });

  it('classifies unquoted values and boolean attributes', () => {
    deepStrictEqual(spans('<input type=checkbox checked value = a/b disabled>'), [
      ['tag', '<input'],
      ['attribute', 'type'],
      ['string', 'checkbox'],
      ['attribute', 'checked'],
      ['attribute', 'value'],
      ['string', 'a/b'],
      ['attribute', 'disabled'],
      ['tag', '>'],
    ]);
  });

  it('classifies void elements with and without a slash', () => {
    deepStrictEqual(spans('<br><hr/><img src=a.png />'), [
      ['tag', '<br'],
      ['tag', '>'],
      ['tag', '<hr'],
      ['tag', '/>'],
      ['tag', '<img'],
      ['attribute', 'src'],
      ['string', 'a.png'],
      ['tag', '/>'],
    ]);
  });

  it('keeps framework attribute names whole', () => {
    deepStrictEqual(spans('<b @click="go()" :class="c" v-on:x=y [p]="q" (e)="f" #r>'), [
      ['tag', '<b'],
      ['attribute', '@click'],
      ['string', '"go()"'],
      ['attribute', ':class'],
      ['string', '"c"'],
      ['attribute', 'v-on:x'],
      ['string', 'y'],
      ['attribute', '[p]'],
      ['string', '"q"'],
      ['attribute', '(e)'],
      ['string', '"f"'],
      ['attribute', '#r'],
      ['tag', '>'],
    ]);
  });

  it('keeps custom element names whole', () => {
    deepStrictEqual(spans('<my-card></my-card>'), [
      ['tag', '<my-card'],
      ['tag', '>'],
      ['tag', '</my-card'],
      ['tag', '>'],
    ]);
  });

  it('classifies a doctype as a keyword', () => {
    deepStrictEqual(spans('<!DOCTYPE html>\n<html lang="en">'), [
      ['keyword', '<!DOCTYPE html>'],
      ['tag', '<html'],
      ['attribute', 'lang'],
      ['string', '"en"'],
      ['tag', '>'],
    ]);
  });

  it('classifies an XML declaration as a keyword', () => {
    deepStrictEqual(spans('<?xml version="1.0"?><html/>'), [
      ['keyword', '<?xml version="1.0"?>'],
      ['tag', '<html'],
      ['tag', '/>'],
    ]);
  });

  it('classifies comments, markup inside included', () => {
    deepStrictEqual(spans('<!-- <script> a --> <p>'), [
      ['comment', '<!-- <script> a -->'],
      ['tag', '<p'],
      ['tag', '>'],
    ]);
  });

  it('classifies a CDATA section as a string', () => {
    deepStrictEqual(spans('<svg><![CDATA[a < b]]></svg>'), [
      ['tag', '<svg'],
      ['tag', '>'],
      ['string', '<![CDATA[a < b]]>'],
      ['tag', '</svg'],
      ['tag', '>'],
    ]);
  });

  it('classifies named and numeric entities as variables', () => {
    deepStrictEqual(spans('a &amp; &#169; &#x2014; &nbsp;b'), [
      ['variable', '&amp;'],
      ['variable', '&#169;'],
      ['variable', '&#x2014;'],
      ['variable', '&nbsp;'],
    ]);
  });

  it('leaves a bare ampersand, `<` and `>` in text plain', () => {
    deepStrictEqual(spans(`<p>a & b < 3 > 1 "q" it's x=y &c</p>`), [
      ['tag', '<p'],
      ['tag', '>'],
      ['tag', '</p'],
      ['tag', '>'],
    ]);
  });

  it('highlights a `<style>` body as CSS', () => {
    deepStrictEqual(spans('<style media="print">\n  a { color: red }\n</style>'), [
      ['tag', '<style'],
      ['attribute', 'media'],
      ['string', '"print"'],
      ['tag', '>'],
      ['tag', 'a'],
      ['property', 'color'],
      ['tag', '</style'],
      ['tag', '>'],
    ]);
  });

  it('highlights a `<script>` body as TypeScript', () => {
    deepStrictEqual(spans('<script type="module">\nif (a < b) f("</p>")\n</script><p>'), [
      ['tag', '<script'],
      ['attribute', 'type'],
      ['string', '"module"'],
      ['tag', '>'],
      ['keyword', 'if'],
      ['function', 'f'],
      ['string', '"</p>"'],
      ['tag', '</script'],
      ['tag', '>'],
      ['tag', '<p'],
      ['tag', '>'],
    ]);
  });

  it('highlights a JSON `<script>` body as JSON', () => {
    deepStrictEqual(spans('<script type=importmap>{"imports": {}}</script>'), [
      ['tag', '<script'],
      ['attribute', 'type'],
      ['string', 'importmap'],
      ['tag', '>'],
      ['property', '"imports"'],
      ['tag', '</script'],
      ['tag', '>'],
    ]);
    deepStrictEqual(spans(`<script type='application/ld+json'>[null]</script>`).slice(4, 5), [
      ['keyword', 'null'],
    ]);
  });

  it('highlights a non-JavaScript `<script>` body as HTML', () => {
    deepStrictEqual(
      spans('<script type="text/x-template"><b class="a">if</b></script>').slice(4, -2),
      [
        ['tag', '<b'],
        ['attribute', 'class'],
        ['string', '"a"'],
        ['tag', '>'],
        ['tag', '</b'],
        ['tag', '>'],
      ],
    );
    for (const type of [
      '',
      ' type=module',
      ' type="text/javascript"',
      " type='application/ecmascript'",
    ]) {
      deepStrictEqual(spans(`<script${type}>let</script>`).at(-3), ['keyword', 'let'], type);
    }
  });

  it('matches `<script>` and `<style>` in any case', () => {
    deepStrictEqual(spans('<SCRIPT>let x</Script ><Style>b{}</STYLE>'), [
      ['tag', '<SCRIPT'],
      ['tag', '>'],
      ['keyword', 'let'],
      ['tag', '</Script'],
      ['tag', '>'],
      ['tag', '<Style'],
      ['tag', '>'],
      ['tag', 'b'],
      ['tag', '</STYLE'],
      ['tag', '>'],
    ]);
  });

  it('keeps a `>` inside a quoted `<script>` attribute in the start tag', () => {
    deepStrictEqual(spans(`<script data-x="a>b">let</script>`), [
      ['tag', '<script'],
      ['attribute', 'data-x'],
      ['string', '"a>b"'],
      ['tag', '>'],
      ['keyword', 'let'],
      ['tag', '</script'],
      ['tag', '>'],
    ]);
  });

  it('leaves an empty `<script>` and a `<scripts>` element alone', () => {
    deepStrictEqual(spans('<script></script><scripts>let</scripts>'), [
      ['tag', '<script'],
      ['tag', '>'],
      ['tag', '</script'],
      ['tag', '>'],
      ['tag', '<scripts'],
      ['tag', '>'],
      ['tag', '</scripts'],
      ['tag', '>'],
    ]);
  });

  it('runs an unterminated `<script>` or `<style>` body to the end', () => {
    deepStrictEqual(spans('<script>let a\n<p>'), [
      ['tag', '<script'],
      ['tag', '>'],
      ['keyword', 'let'],
    ]);
    deepStrictEqual(spans('<style>a{'), [
      ['tag', '<style'],
      ['tag', '>'],
      ['tag', 'a'],
    ]);
  });

  it('keeps a `<` inside a closed quoted value', () => {
    deepStrictEqual(spans(`<p title="5 < 6" v-if='a<b' class=c>`), [
      ['tag', '<p'],
      ['attribute', 'title'],
      ['string', '"5 < 6"'],
      ['attribute', 'v-if'],
      ['string', "'a<b'"],
      ['attribute', 'class'],
      ['string', 'c'],
      ['tag', '>'],
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

  it('runs an unterminated comment or CDATA to the end', () => {
    deepStrictEqual(spans('<!-- a\n<b>'), [['comment', '<!-- a\n<b>']]);
    deepStrictEqual(spans('<![CDATA[ a\n<b>'), [['string', '<![CDATA[ a\n<b>']]);
  });

  it('closes an unclosed tag at the next markup', () => {
    deepStrictEqual(spans('<a b <!-- c --> d'), [
      ['tag', '<a'],
      ['attribute', 'b'],
      ['comment', '<!-- c -->'],
    ]);
  });

  it('leaves a `<` that opens no name plain', () => {
    deepStrictEqual(spans('a < 3 <1 </>'), []);
  });

  it('starts every call outside a tag', () => {
    tokenizeHTML('<a');
    deepStrictEqual(spans('b>'), []);
  });

  it('stays linear on adversarial input', () => {
    const units = [
      '<a x="',
      '<a x="<',
      '<a x="<a" ',
      `=" '`,
      '<script type=x>',
      '<script type=x><style>',
      '<!--',
      '<![CDATA[',
      '<?',
      '<!D',
      '<a ',
      '="',
      '=',
      '&a',
      '<',
      '"',
      '<script',
      '<script ',
      '<script "',
      `<script '`,
      '<script>',
      '<style>{',
      '<script></script>',
      '<style>a</style>',
      '</script',
    ];
    for (const unit of units) {
      const code = unit.repeat(Math.ceil(1_000_000 / unit.length));
      const started = performance.now();
      const tokens = tokenizeHTML(code);
      ok(performance.now() - started < 1000, unit);
      let end = 0;
      for (const token of tokens) {
        ok(token.start >= end && token.end > token.start && token.end <= code.length, unit);
        end = token.end;
      }
    }
  });
});
