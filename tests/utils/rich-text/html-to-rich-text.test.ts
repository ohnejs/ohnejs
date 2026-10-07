import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { NodeLike, RichText, RichTextRun } from '../../../src/utils/index.ts';

import { checkRichText, htmlToRichText, isRichText } from '../../../src/utils/index.ts';
import { comment, el, text } from '../html/_node-like.ts';
import { PAGE, PERMISSIVE } from './fixtures.ts';

function body(...children: NodeLike[]): NodeLike {
  return el('body', {}, ...children);
}

function p(...content: RichTextRun[]): RichText[number] {
  return { kind: 'paragraph', content };
}

function parse(...children: NodeLike[]): RichText {
  return htmlToRichText(body(...children));
}

describe('htmlToRichText', () => {
  describe('blocks', () => {
    it('reads `p`, a `div` of inline content, and loose text as paragraphs', () => {
      deepStrictEqual(
        parse(el('p', {}, text('a')), el('div', {}, text('b')), text('c'), el('p', {}, text('d'))),
        [p({ text: 'a' }), p({ text: 'b' }), p({ text: 'c' }), p({ text: 'd' })],
      );
    });

    it('lets sectioning elements mark block boundaries only', () => {
      deepStrictEqual(
        parse(
          text('a'),
          el('section', {}, text('b'), el('article', {}, el('p', {}, text('c'))), text('d')),
          el('hr', {}),
          text('e'),
        ),
        [p({ text: 'a' }), p({ text: 'b' }), p({ text: 'c' }), p({ text: 'd' }), p({ text: 'e' })],
      );
    });

    it('reads `h1` as level 2 and `h2` to `h6` at their level', () => {
      deepStrictEqual(
        parse(...[1, 2, 3, 4, 5, 6].map((level) => el(`h${level}`, {}, text('h')))),
        [2, 2, 3, 4, 5, 6].map((level) => ({ kind: 'heading', level, content: [{ text: 'h' }] })),
      );
    });

    it('reads a `blockquote` as one quote per inner block', () => {
      deepStrictEqual(
        parse(
          el('blockquote', {}, el('p', {}, text('a')), el('p', {}, text('b'))),
          el('blockquote', {}, text('c')),
          el('blockquote', {}, el('ul', {}, el('li', {}, text('d')), el('li', {}, text('e')))),
        ),
        [
          { kind: 'quote', content: [{ text: 'a' }] },
          { kind: 'quote', content: [{ text: 'b' }] },
          { kind: 'quote', content: [{ text: 'c' }] },
          { kind: 'quote', content: [{ text: 'd\ne' }] },
        ],
      );
    });

    it('reads `ul` and `ol`, unwraps `li > p`, and nests a list inside an item', () => {
      deepStrictEqual(
        parse(
          el(
            'ol',
            {},
            el('li', {}, el('p', {}, text('a'))),
            el('li', {}, text('b'), el('ul', {}, el('li', {}, text('c')))),
          ),
        ),
        [
          {
            kind: 'list',
            ordered: true,
            items: [
              { content: [{ text: 'a' }] },
              {
                content: [{ text: 'b' }],
                list: { kind: 'list', ordered: false, items: [{ content: [{ text: 'c' }] }] },
              },
            ],
          },
        ],
      );
    });

    it('joins a list sitting directly inside a list to the item before it', () => {
      deepStrictEqual(
        parse(
          el(
            'ul',
            {},
            el('ul', {}, el('li', {}, text('0'))),
            el('li', {}, text('1')),
            el('ul', {}, el('li', {}, text('2'))),
            el('ul', {}, el('li', {}, text('3'))),
          ),
        ),
        [
          {
            kind: 'list',
            ordered: false,
            items: [
              {
                content: [],
                list: { kind: 'list', ordered: false, items: [{ content: [{ text: '0' }] }] },
              },
              {
                content: [{ text: '1' }],
                list: {
                  kind: 'list',
                  ordered: false,
                  items: [{ content: [{ text: '2' }] }, { content: [{ text: '3' }] }],
                },
              },
            ],
          },
        ],
      );
    });

    it('joins the blocks inside an item with `\\n`', () => {
      deepStrictEqual(
        parse(el('ul', {}, el('li', {}, el('p', {}, text('a')), el('p', {}, text('b'))))),
        [{ kind: 'list', ordered: false, items: [{ content: [{ text: 'a\nb' }] }] }],
      );
    });

    it('reads `pre` as a paragraph marked `code`, keeping its whitespace', () => {
      deepStrictEqual(parse(el('pre', {}, text('a  b\n  c'), el('br', {}), text('d\n'))), [
        p({ text: 'a  b\n  c\nd', marks: ['code'] }),
      ]);
    });

    it('reads a `table` as one paragraph per row, with cells joined by ` | `', () => {
      deepStrictEqual(
        parse(
          el(
            'table',
            {},
            el('caption', {}, text('t')),
            el('thead', {}, el('tr', {}, el('th', {}, text('a')), el('th', {}, text('b')))),
            el('tbody', {}, el('tr', {}, el('td', {}, el('p', {}, text('c'))), el('td', {}))),
            el('tr', {}, el('td', {}, text('d'))),
          ),
        ),
        [p({ text: 't' }), p({ text: 'a | b' }), p({ text: 'c | ' }), p({ text: 'd' })],
      );
    });

    it('drops media, scripts, styles, templates, the head and form controls with their content', () => {
      deepStrictEqual(
        parse(
          el('head', {}, el('title', {}, text('t')), el('style', {}, text('p{}'))),
          el('p', {}, text('a'), el('img', { src: 'x', onerror: 'alert(1)' }), text('b')),
          el('script', {}, text('alert(1)')),
          el('svg', {}, el('text', {}, text('s'))),
          el('template', {}, el('p', {}, text('tpl'))),
          el('input', { value: 'v' }),
          el('select', {}, el('option', {}, text('o'))),
          el('button', {}, text('go')),
          el('video', {}, el('track', {})),
        ),
        [p({ text: 'ab' })],
      );
    });

    it('reads a `br` inside a leaf as `\\n` and ignores one between blocks', () => {
      deepStrictEqual(
        parse(
          el('p', {}, text('a'), el('br', {}), text('b')),
          el('br', {}),
          el('p', {}, text('c')),
          el('br', {}),
          text('d'),
          el('br', {}),
          el('br', {}),
          text('e'),
        ),
        [p({ text: 'a\nb' }), p({ text: 'c' }), p({ text: 'd\n\ne' })],
      );
    });

    it('ignores a `br` between blocks however the source spaces it', () => {
      const br = el('br', {});
      deepStrictEqual(
        parse(el('p', {}, text('a')), text('\n'), br, text(' \n'), br, el('p', {}, text('b'))),
        [p({ text: 'a' }), p({ text: 'b' })],
      );
    });

    it('keeps a `br` at the start of a leaf and drops one at its end', () => {
      deepStrictEqual(
        parse(el('p', {}, el('br', {}), text('a'), el('br', {})), el('p', {}, el('br', {}))),
        [p({ text: '\na' }), p()],
      );
    });

    it('reads blocks through an inline wrapper', () => {
      deepStrictEqual(
        parse(
          el(
            'b',
            { style: 'font-weight:normal' },
            el('p', {}, text('a'), el('b', {}, text('b'))),
            el('p', {}, text('c')),
          ),
        ),
        [p({ text: 'a' }, { text: 'b', marks: ['strong'] }), p({ text: 'c' })],
      );
    });

    it('skips comments and reads `o:p` and unknown elements as inline', () => {
      deepStrictEqual(
        parse(el('p', {}, comment('[if !supportLists]'), text('a'), el('o:p', {}, text('b')))),
        [p({ text: 'ab' })],
      );
    });

    it('reads an empty root as `[]`', () => {
      deepStrictEqual(parse(), []);
      deepStrictEqual(parse(text('  \n ')), []);
    });
  });

  describe('marks', () => {
    it('maps elements to marks, in `RICH_TEXT_MARKS` order', () => {
      const pairs: [string, RichTextRun['marks']][] = [
        ['b', ['strong']],
        ['strong', ['strong']],
        ['i', ['em']],
        ['em', ['em']],
        ['s', ['del']],
        ['del', ['del']],
        ['strike', ['del']],
        ['code', ['code']],
        ['kbd', ['code']],
        ['samp', ['code']],
        ['tt', ['code']],
      ];
      for (const [tag, marks] of pairs) {
        deepStrictEqual(parse(el('p', {}, el(tag, {}, text('a')))), [p({ text: 'a', marks })]);
      }
      deepStrictEqual(parse(el('p', {}, el('code', {}, el('i', {}, el('b', {}, text('a')))))), [
        p({ text: 'a', marks: ['strong', 'em', 'code'] }),
      ]);
    });

    it('reads a `font-weight` of 600 or more as strong and 500 or less as its cancellation', () => {
      deepStrictEqual(
        parse(
          el(
            'p',
            {},
            el('span', { style: 'font-weight: 600' }, text('a')),
            el('span', { style: 'FONT-WEIGHT: Bold' }, text('b')),
            el('b', { style: 'font-weight:500' }, text('c')),
            el(
              'b',
              { style: 'font-weight:normal' },
              text('d'),
              el('span', { style: 'font-weight:700' }, text('e')),
            ),
          ),
        ),
        [p({ text: 'ab', marks: ['strong'] }, { text: 'cd' }, { text: 'e', marks: ['strong'] })],
      );
    });

    it('reads an italic style, a line-through decoration and a monospace family', () => {
      deepStrictEqual(
        parse(
          el(
            'p',
            {},
            el('span', { style: 'font-style:italic' }, text('a')),
            el('em', { style: 'font-style:normal' }, text('b')),
            el('span', { style: 'text-decoration: underline line-through' }, text('c')),
            el('span', { style: 'text-decoration-line:line-through' }, text('d')),
            el('span', { style: 'font-family: "Courier New", serif' }, text('e')),
            el('span', { style: 'font-family: monospace' }, text('f')),
            el('span', { style: 'font-family: serif, monospace' }, text('g')),
          ),
        ),
        [
          p(
            { text: 'a', marks: ['em'] },
            { text: 'b' },
            { text: 'cd', marks: ['del'] },
            { text: 'ef', marks: ['code'] },
            { text: 'g' },
          ),
        ],
      );
    });

    it('passes `u`, `sub`, `sup`, `mark`, `small`, `font`, `span` and `abbr` through', () => {
      for (const tag of ['u', 'sub', 'sup', 'mark', 'small', 'font', 'span', 'abbr']) {
        deepStrictEqual(parse(el('p', {}, el(tag, {}, text('a')))), [p({ text: 'a' })]);
      }
    });
  });

  describe('links', () => {
    it('reads a safe `href` as a URL link, with `newTab` from `target="_blank"`', () => {
      deepStrictEqual(
        parse(
          el(
            'p',
            {},
            el('a', { href: 'https://x.y' }, text('a')),
            el('a', { href: ' /b ', target: '_blank' }, text('b')),
            el('a', { href: 'mailto:a@b.c', target: '_self' }, el('b', {}, text('c'))),
          ),
        ),
        [
          p(
            { text: 'a', link: { url: 'https://x.y' } },
            { text: 'b', link: { url: '/b', newTab: true } },
            { text: 'c', marks: ['strong'], link: { url: 'mailto:a@b.c' } },
          ),
        ],
      );
    });

    it('keeps only the text of a fragment, an unsafe URL and an anchor without `href`', () => {
      deepStrictEqual(
        parse(
          el(
            'p',
            {},
            el('a', { href: '#top' }, text('a')),
            el('a', { href: 'javascript:alert(1)' }, text('b')),
            el('a', { href: 'https://u:p@x.y' }, text('c')),
            el('a', { name: 'd' }, text('d')),
            el('a', { href: '' }, text('e')),
          ),
        ),
        [p({ text: 'abcde' })],
      );
    });

    it('unwraps a `google.com/url?q=` redirect', () => {
      const wrapped = 'https://www.google.com/url?q=https://x.y/a?b%3Dc&sa=D&source=docs';
      deepStrictEqual(
        parse(
          el('p', {}, el('a', { href: wrapped }, text('a'))),
          el('p', {}, el('a', { href: 'https://google.com/url?q=javascript:x' }, text('b'))),
          el('p', {}, el('a', { href: 'https://www.google.com/search?q=x' }, text('c'))),
        ),
        [
          p({ text: 'a', link: { url: 'https://x.y/a?b=c' } }),
          p({ text: 'b' }),
          p({ text: 'c', link: { url: 'https://www.google.com/search?q=x' } }),
        ],
      );
    });

    it('takes the link `options.link` returns ahead of the URL rules', () => {
      const anchors = new WeakMap<NodeLike, RichTextRun['link']>();
      const record = el('a', { href: '/dashboard/collections/pages/1' }, text('a'));
      const plain = el('a', { href: 'https://x.y' }, text('b'));
      anchors.set(record, { collection: 'Pages', record: PAGE, hash: 'top' });
      deepStrictEqual(
        htmlToRichText(body(el('p', {}, record, plain)), { link: (anchor) => anchors.get(anchor) }),
        [
          p(
            { text: 'a', link: { collection: 'Pages', record: PAGE, hash: 'top' } },
            { text: 'b', link: { url: 'https://x.y' } },
          ),
        ],
      );
    });
  });

  describe('whitespace', () => {
    it('collapses whitespace across runs and trims each line', () => {
      deepStrictEqual(
        parse(
          el(
            'p',
            {},
            text('\n  a \t'),
            el('b', {}, text(' b ')),
            text('  c '),
            el('br', {}),
            text('  d  '),
            el('i', {}, text('  ')),
            text('\n'),
          ),
        ),
        [p({ text: 'a ' }, { text: 'b ', marks: ['strong'] }, { text: 'c\nd' })],
      );
    });

    it('keeps every space under `options.pre`, without the `code` mark', () => {
      deepStrictEqual(
        htmlToRichText(
          body(el('p', {}, text('hello ')), el('p', {}, text(' a  b'), el('br', {}))),
          {
            pre: true,
          },
        ),
        [p({ text: 'hello ' }), p({ text: ' a  b' })],
      );
    });

    it('turns NBSP into a space and removes U+200B and U+FEFF', () => {
      deepStrictEqual(parse(el('p', {}, text('a  b​c﻿')), el('pre', {}, text('d e'))), [
        p({ text: 'a bc' }),
        p({ text: 'd e', marks: ['code'] }),
      ]);
    });
  });

  it('gives a value that `isRichText` accepts and `checkRichText` passes under permissive options', () => {
    const value = parse(
      el('h1', {}, text('t')),
      el('p', {}, el('a', { href: 'https://x.y' }, el('s', {}, text('a')))),
      el('ul', {}, el('li', {}, text('1'), el('ol', {}, el('li', {}, text('2'))))),
    );
    ok(isRichText(value));
    deepStrictEqual(checkRichText(value, PERMISSIVE), []);
  });

  it('nests lists as deep as the HTML does, leaving the clip to `conformRichText`', () => {
    const nested = (depth: number): NodeLike =>
      el('ul', {}, el('li', {}, text(`${depth}`), ...(depth > 1 ? [nested(depth - 1)] : [])));
    const value = parse(nested(5));
    ok(!isRichText(value));
    deepStrictEqual(checkRichText(value, PERMISSIVE), [
      {
        path: '[0].items[0].list.items[0].list.items[0].list.items[0].list',
        key: 'validation.maxDepth',
        params: { max: 4 },
      },
    ]);
  });
});
