import type { RichText, RichTextOptions } from '../../../src/utils/index.ts';

export interface RichTextFixture {
  name: string;
  input: RichText;
  normalized: RichText;
  text: string;
  html: string;
  options?: RichTextOptions;
}

export const PAGE = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

export const PERMISSIVE: RichTextOptions = {
  elements: ['h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote'],
  marks: ['strong', 'em', 'del', 'code'],
  links: ['Pages'],
};

export const FIXTURES: RichTextFixture[] = [
  { name: 'empty', input: [], normalized: [], text: '', html: '' },
  {
    name: 'paragraph',
    input: [{ kind: 'paragraph', content: [{ text: 'Hello, world' }] }],
    normalized: [{ kind: 'paragraph', content: [{ text: 'Hello, world' }] }],
    text: 'Hello, world',
    html: '<p>Hello, world</p>',
  },
  {
    name: 'marks',
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: 'a', marks: ['em', 'strong'] },
          { text: '' },
          { text: 'b', marks: ['strong', 'em', 'em'] },
          { text: 'c', marks: [] },
          { text: 'd', marks: ['code', 'del', 'em', 'strong'] },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [
          { text: 'ab', marks: ['strong', 'em'] },
          { text: 'c' },
          { text: 'd', marks: ['strong', 'em', 'del', 'code'] },
        ],
      },
    ],
    text: 'abcd',
    html: '<p><strong><em>ab</em></strong>c<strong><em><del><code>d</code></del></em></strong></p>',
  },
  {
    name: 'headings',
    input: headings(),
    normalized: headings(),
    text: 'h2\n\nh3\n\nh4\n\nh5\n\nh6',
    html: '<h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>',
  },
  {
    name: 'quote',
    input: [{ kind: 'quote', content: [{ text: 'One line\r\nand another' }] }],
    normalized: [{ kind: 'quote', content: [{ text: 'One line\nand another' }] }],
    text: 'One line\nand another',
    html: '<blockquote><p>One line<br>and another</p></blockquote>',
  },
  {
    name: 'nested lists',
    input: [
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            content: [{ text: 'one' }],
            list: {
              kind: 'list',
              ordered: true,
              items: [
                {
                  content: [{ text: 'two' }],
                  list: {
                    kind: 'list',
                    ordered: false,
                    items: [
                      {
                        content: [],
                        list: {
                          kind: 'list',
                          ordered: true,
                          items: [{ content: [{ text: 'four' }] }],
                        },
                      },
                    ],
                  },
                },
                { content: [], list: { kind: 'list', ordered: false, items: [{ content: [] }] } },
              ],
            },
          },
          { content: [{ text: '' }] },
        ],
      },
      { kind: 'list', ordered: true, items: [] },
      { kind: 'list', ordered: true, items: [{ content: [{ text: 'next list' }] }] },
    ],
    normalized: [
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            content: [{ text: 'one' }],
            list: {
              kind: 'list',
              ordered: true,
              items: [
                {
                  content: [{ text: 'two' }],
                  list: {
                    kind: 'list',
                    ordered: false,
                    items: [
                      {
                        content: [],
                        list: {
                          kind: 'list',
                          ordered: true,
                          items: [{ content: [{ text: 'four' }] }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      { kind: 'list', ordered: true, items: [{ content: [{ text: 'next list' }] }] },
    ],
    text: 'one\ntwo\n\nfour\n\nnext list',
    html:
      '<ul><li>one<ol><li>two<ul><li><br><ol><li>four</li></ol></li></ul></li></ol></li></ul>' +
      '<ol><li>next list</li></ol>',
  },
  {
    name: 'record link',
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: 'See ' },
          {
            text: 'about',
            link: {
              collection: 'Pages',
              record: PAGE,
              hash: '#team',
              newTab: false,
              href: '/about',
            },
          },
          { text: ' us', link: { collection: 'Pages', record: PAGE, hash: 'team' } },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [
          { text: 'See ' },
          { text: 'about us', link: { collection: 'Pages', record: PAGE, hash: 'team' } },
        ],
      },
    ],
    text: 'See about us',
    html: '<p>See about us</p>',
  },
  {
    name: 'url link',
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: 'Mail', marks: ['strong'], link: { url: ' mailto:a@b.c ', newTab: true } },
          { text: ' or call', link: { url: 'tel:+1-555' } },
          { text: '.' },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [
          { text: 'Mail', marks: ['strong'], link: { url: 'mailto:a@b.c', newTab: true } },
          { text: ' or call', link: { url: 'tel:+1-555' } },
          { text: '.' },
        ],
      },
    ],
    text: 'Mail or call.',
    html:
      '<p><a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer"><strong>Mail</strong></a>' +
      '<a href="tel:+1-555"> or call</a>.</p>',
  },
  {
    name: 'trailing empty blocks',
    input: [
      { kind: 'paragraph', content: [{ text: 'a' }] },
      { kind: 'paragraph', content: [] },
      { kind: 'paragraph', content: [{ text: 'b' }] },
      { kind: 'heading', level: 2, content: [{ text: '\n' }] },
      { kind: 'quote', content: [] },
      { kind: 'list', ordered: false, items: [{ content: [] }] },
      { kind: 'paragraph', content: [{ text: '' }] },
    ],
    normalized: [
      { kind: 'paragraph', content: [{ text: 'a' }] },
      { kind: 'paragraph', content: [] },
      { kind: 'paragraph', content: [{ text: 'b' }] },
    ],
    text: 'a\n\n\n\nb',
    html: '<p>a</p><p><br></p><p>b</p>',
  },
  {
    name: 'text cleanup',
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: '\n\nlone \uD800 surrogate\r\n' },
          { text: 'tab\tbell\u0007del\u007f\rnull\u0000' },
          { text: '\u0000', marks: ['em'] },
          { text: '\n \n' },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [{ text: 'lone � surrogate\ntab\tbelldel\nnull\n ' }],
      },
    ],
    text: 'lone � surrogate\ntab\tbelldel\nnull\n ',
    html: '<p>lone � surrogate<br>tab\tbelldel<br>null<br> </p>',
  },
  {
    name: 'composition',
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: 'cafe' },
          { text: '́', marks: [] },
          { text: 'e', marks: ['em'] },
          { text: '́' },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [{ text: 'café' }, { text: 'e', marks: ['em'] }, { text: '́' }],
      },
    ],
    text: 'caféé',
    html: '<p>café<em>e</em>́</p>',
  },
  {
    name: 'line breaks off',
    options: { lineBreaks: false },
    input: [{ kind: 'paragraph', content: [{ text: '\nfirst\r\nsecond\n' }] }],
    normalized: [{ kind: 'paragraph', content: [{ text: ' first second ' }] }],
    text: ' first second ',
    html: '<p> first second </p>',
  },
  {
    name: 'inline',
    options: { inline: true },
    input: [
      {
        kind: 'paragraph',
        content: [
          { text: 'Read ', marks: ['em'] },
          { text: 'the docs', marks: ['em'], link: { url: '/docs#start' } },
          { text: '\n' },
        ],
      },
    ],
    normalized: [
      {
        kind: 'paragraph',
        content: [
          { text: 'Read ', marks: ['em'] },
          { text: 'the docs', marks: ['em'], link: { url: '/docs#start' } },
        ],
      },
    ],
    text: 'Read the docs',
    html: '<em>Read </em><a href="/docs#start"><em>the docs</em></a>',
  },
];

function headings(): RichText {
  return ([2, 3, 4, 5, 6] as const).map((level) => ({
    kind: 'heading',
    level,
    content: [{ text: `h${level}` }],
  }));
}
