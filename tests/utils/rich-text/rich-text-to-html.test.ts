import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText, RichTextRun } from '../../../src/utils/index.ts';

import {
  decodeXMLEntities,
  isSafeHref,
  richTextLinks,
  richTextToHTML,
} from '../../../src/utils/index.ts';
import { FIXTURES, PAGE } from './fixtures.ts';

type Random = () => number;

function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: Random, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)];
}

function chance(rnd: Random, probability: number): boolean {
  return rnd() < probability;
}

function times<T>(rnd: Random, max: number, make: () => T): T[] {
  return Array.from({ length: Math.floor(rnd() * (max + 1)) }, make);
}

const TEXTS = [
  'a',
  'b c',
  '',
  '\n',
  'é',
  '<script>alert(1)</script>',
  `"'&`,
  '</a><a href="javascript:x">',
  'x > y',
  '&amp;',
];
const HREFS = [
  'https://x.y',
  'https://x.y/?a=1&b="2"',
  '/a?b#c',
  '#top',
  'mailto:a@b.c',
  'tel:+1-555',
  'javascript:alert(1)',
  'JaVaScRiPt:x',
  'data:text/html,x',
  '//evil.com',
  '/\\evil.com',
  'https://u@x.y',
  ' https://x.y',
  'java\tscript:x',
  '"><script>alert(1)</script>',
  'https://x.y/" onclick="x',
];
const MARKS = ['strong', 'em', 'del', 'code', 'u', 1, null];
const GARBAGE = [null, 1, 'x', [], {}, { kind: 'aside', content: [{ text: '<' }] }];

function genLink(rnd: Random): unknown {
  if (chance(rnd, 0.2)) return pick(rnd, [null, 'x', 1, { url: 1 }, { collection: 'Pages' }]);
  const newTab = chance(rnd, 0.4) ? { newTab: pick(rnd, [true, false, 'yes']) } : {};
  const href = chance(rnd, 0.8) ? { href: pick(rnd, HREFS) } : {};
  if (chance(rnd, 0.5)) return { url: pick(rnd, HREFS), ...href, ...newTab };
  return { collection: 'Pages', record: PAGE, ...href, ...newTab };
}

function genRun(rnd: Random): unknown {
  if (chance(rnd, 0.1)) return pick(rnd, GARBAGE);
  const marks = chance(rnd, 0.1) ? 'strong' : times(rnd, 3, () => pick(rnd, MARKS));
  return {
    text: chance(rnd, 0.05) ? 1 : pick(rnd, TEXTS),
    ...(chance(rnd, 0.5) ? { marks } : {}),
    ...(chance(rnd, 0.5) ? { link: genLink(rnd) } : {}),
  };
}

function genContent(rnd: Random): unknown {
  return chance(rnd, 0.05) ? pick(rnd, GARBAGE) : times(rnd, 4, () => genRun(rnd));
}

function genList(rnd: Random, depth: number): unknown {
  const item = (): unknown =>
    chance(rnd, 0.1)
      ? pick(rnd, GARBAGE)
      : {
          content: genContent(rnd),
          ...(depth < 6 && chance(rnd, 0.5) ? { list: genList(rnd, depth + 1) } : {}),
        };
  return {
    kind: 'list',
    ordered: pick(rnd, [true, false, 'x']),
    items: chance(rnd, 0.05) ? 'x' : times(rnd, 3, item),
  };
}

function genBlock(rnd: Random): unknown {
  switch (pick(rnd, ['paragraph', 'heading', 'quote', 'list', 'garbage'])) {
    case 'paragraph':
      return { kind: 'paragraph', content: genContent(rnd) };
    case 'heading':
      return {
        kind: 'heading',
        level: pick(rnd, [2, 3, 4, 5, 6, 1, 7, 'x']),
        content: genContent(rnd),
      };
    case 'quote':
      return { kind: 'quote', content: genContent(rnd) };
    case 'list':
      return genList(rnd, 1);
    default:
      return pick(rnd, GARBAGE);
  }
}

function genDocument(rnd: Random): unknown {
  return chance(rnd, 0.05) ? pick(rnd, GARBAGE) : times(rnd, 6, () => genBlock(rnd));
}

const TAGS = 'p|h[2-6]|blockquote|ul|ol|li|strong|em|del|code';
const ALLOWED = new RegExp(
  `<(?:${TAGS}|br|/(?:${TAGS}|a)|a href="([^"]*)"(?: target="_blank" rel="noopener noreferrer")?)>`,
  'g',
);

function paragraph(...content: RichTextRun[]): RichText {
  return [{ kind: 'paragraph', content }];
}

function inline(...content: RichTextRun[]): string {
  return richTextToHTML(paragraph(...content), { inline: true });
}

describe('richTextToHTML', () => {
  it("gives `''` for `[]`, in both modes", () => {
    strictEqual(richTextToHTML([]), '');
    strictEqual(richTextToHTML([], { inline: true }), '');
  });

  it('renders every normalized fixture under its options', () => {
    for (const { name, normalized, options, html } of FIXTURES) {
      strictEqual(richTextToHTML(normalized, options), html, name);
    }
  });

  it('escapes text through `escapeXML`', () => {
    strictEqual(inline({ text: `<b>&"'` }), '&lt;b&gt;&amp;&quot;&apos;');
  });

  it('escapes attributes through `escapeXML`', () => {
    strictEqual(
      inline({ text: 'a', link: { url: 'https://x.y/?a=1&b="2"' } }),
      '<a href="https://x.y/?a=1&amp;b=&quot;2&quot;">a</a>',
    );
  });

  it('turns `\\n` into `<br>`', () => {
    strictEqual(inline({ text: 'a\n\nb' }), 'a<br><br>b');
  });

  it('renders an empty leaf as `<br>`', () => {
    strictEqual(
      richTextToHTML([
        { kind: 'paragraph', content: [] },
        { kind: 'heading', level: 3, content: [{ text: '' }] },
        { kind: 'quote', content: [] },
        { kind: 'list', ordered: false, items: [{ content: [] }] },
      ]),
      '<p><br></p><h3><br></h3><blockquote><p><br></p></blockquote><ul><li><br></li></ul>',
    );
  });

  it('nests marks in `RICH_TEXT_MARKS` order, whatever order the run lists them in', () => {
    strictEqual(
      inline({ text: 'a', marks: ['code', 'del', 'em', 'strong'] }),
      '<strong><em><del><code>a</code></del></em></strong>',
    );
    strictEqual(
      inline({ text: 'a', marks: ['code', 'strong'] }),
      '<strong><code>a</code></strong>',
    );
  });

  it('renders a duplicate mark once', () => {
    strictEqual(inline({ text: 'a', marks: ['em', 'em'] }), '<em>a</em>');
  });

  it('nests marks inside the `<a>` of a link', () => {
    strictEqual(
      inline({ text: 'a', marks: ['strong', 'code'], link: { url: '/a' } }),
      '<a href="/a"><strong><code>a</code></strong></a>',
    );
  });

  it('shares one `<a>` between neighbouring runs with an equal link', () => {
    strictEqual(
      inline(
        { text: 'a', marks: ['strong'], link: { url: '/a' } },
        { text: 'b', link: { url: '/a' } },
        { text: 'c', link: { url: '/a', newTab: true } },
        { text: 'd' },
        { text: 'e', link: { url: '/a' } },
      ),
      '<a href="/a"><strong>a</strong>b</a>' +
        '<a href="/a" target="_blank" rel="noopener noreferrer">c</a>' +
        'd<a href="/a">e</a>',
    );
  });

  it('takes `href` from a record link, and renders one without it as text', () => {
    const record = { collection: 'Pages', record: PAGE, hash: 'team' };
    strictEqual(
      inline({ text: 'a', link: { ...record, href: '/about#team' } }, { text: 'b', link: record }),
      '<a href="/about#team">a</a>b',
    );
  });

  it('takes `url` from a URL link and ignores a forged `href`', () => {
    strictEqual(
      inline({ text: 'a', link: { url: '/a', href: 'javascript:x' } }),
      '<a href="/a">a</a>',
    );
  });

  it('renders a link as text when its address fails `isSafeHref`', () => {
    for (const href of [
      'javascript:alert(1)',
      ' /a',
      'java\tscript:x',
      '//evil.com',
      'https://u@x.y',
    ]) {
      strictEqual(inline({ text: 'a', link: { url: href } }), 'a', href);
      strictEqual(
        inline({ text: 'a', link: { collection: 'Pages', record: PAGE, href } }),
        'a',
        href,
      );
    }
  });

  it('adds `target` and `rel` after `href` only for `newTab: true`', () => {
    strictEqual(
      inline({ text: 'a', link: { url: '/a', newTab: true } }),
      '<a href="/a" target="_blank" rel="noopener noreferrer">a</a>',
    );
    strictEqual(inline({ text: 'a', link: { url: '/a', newTab: false } }), '<a href="/a">a</a>');
  });

  it('drops block tags and joins block and item boundaries with `<br>` under `inline`', () => {
    strictEqual(
      richTextToHTML(
        [
          { kind: 'heading', level: 2, content: [{ text: 'a' }] },
          { kind: 'paragraph', content: [] },
          { kind: 'quote', content: [{ text: 'b', marks: ['em'] }] },
          {
            kind: 'list',
            ordered: true,
            items: [
              {
                content: [{ text: 'c' }],
                list: { kind: 'list', ordered: false, items: [{ content: [{ text: 'd' }] }] },
              },
              { content: [{ text: 'e' }] },
            ],
          },
        ],
        { inline: true },
      ),
      'a<br><br><em>b</em><br>c<br>d<br>e',
    );
  });

  it('renders nothing for a value that is not an array', () => {
    for (const value of [null, undefined, 'a', 1, {}, { kind: 'paragraph', content: [] }]) {
      strictEqual(richTextToHTML(value), '');
      strictEqual(richTextToHTML(value, { inline: true }), '');
    }
  });

  it('skips a block it cannot read', () => {
    strictEqual(
      richTextToHTML([
        null,
        'x',
        { kind: 'aside', content: [{ text: 'a' }] },
        { kind: 'heading', level: 7, content: [{ text: 'b' }] },
        { kind: 'heading', level: '2', content: [{ text: 'c' }] },
        { kind: 'list', ordered: true, items: 'x' },
        { kind: 'paragraph', content: [{ text: 'd' }] },
      ]),
      '<p>d</p>',
    );
  });

  it('renders a block without readable runs as an empty leaf', () => {
    strictEqual(
      richTextToHTML([
        { kind: 'paragraph', content: 'a' },
        { kind: 'paragraph', content: [null, 'b', { text: 1 }, { marks: ['em'] }] },
      ]),
      '<p><br></p><p><br></p>',
    );
  });

  it('skips a run it cannot read, and reads the rest of the leaf', () => {
    strictEqual(
      richTextToHTML([{ kind: 'paragraph', content: [{ text: 'a' }, { text: 1 }, { text: 'b' }] }]),
      '<p>ab</p>',
    );
  });

  it('ignores marks and links it cannot read', () => {
    strictEqual(
      richTextToHTML([
        {
          kind: 'paragraph',
          content: [
            { text: 'a', marks: 'strong' },
            { text: 'b', marks: ['u', 1, 'em'] },
            { text: 'c', link: 'https://x.y' },
            { text: 'd', link: { url: 1 } },
            { text: 'e', link: { url: '/e', newTab: 'yes' } },
          ],
        },
      ]),
      '<p>a<em>b</em>cd<a href="/e">e</a></p>',
    );
  });

  it('reads `ordered` as `<ol>` only when it is `true`', () => {
    strictEqual(
      richTextToHTML([
        { kind: 'list', ordered: 'yes', items: [{ content: [{ text: 'a' }] }] },
        { kind: 'list', ordered: true, items: [{ content: [{ text: 'b' }] }] },
      ]),
      '<ul><li>a</li></ul><ol><li>b</li></ol>',
    );
  });

  it('skips an item it cannot read', () => {
    strictEqual(
      richTextToHTML([
        { kind: 'list', ordered: false, items: [null, { content: [{ text: 'a' }] }, 'x'] },
      ]),
      '<ul><li>a</li></ul>',
    );
  });

  it('skips a nested list whose `kind` is not `list`, in both modes', () => {
    const value = [
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            content: [{ text: 'a' }],
            list: { kind: 'aside', items: [{ content: [{ text: 'b' }] }] },
          },
          { content: [{ text: 'c' }], list: { items: [{ content: [{ text: 'd' }] }] } },
        ],
      },
    ];
    strictEqual(richTextToHTML(value), '<ul><li>a</li><li>c</li></ul>');
    strictEqual(richTextToHTML(value, { inline: true }), 'a<br>c');
  });

  it('renders lists four levels deep, and skips a fifth', () => {
    const list = (depth: number): unknown => ({
      kind: 'list',
      ordered: false,
      items: [{ content: [{ text: `${depth}` }], ...(depth < 5 ? { list: list(depth + 1) } : {}) }],
    });
    strictEqual(
      richTextToHTML([list(1)]),
      '<ul><li>1<ul><li>2<ul><li>3<ul><li>4</li></ul></li></ul></li></ul></li></ul>',
    );
    strictEqual(richTextToHTML([list(1)], { inline: true }), '1<br>2<br>3<br>4');
  });

  it('leaves no `<` once the allowed tags are stripped, and no unsafe `href`, across seeded documents', () => {
    const rnd = mulberry32(2026);
    let links = 0;
    let text = 0;
    for (let i = 0; i < 300; i++) {
      const document = genDocument(rnd);
      richTextLinks(document);
      for (const inline of [false, true]) {
        const html = richTextToHTML(document, { inline });
        const stripped = html.replace(ALLOWED, (_, href?: string) => {
          if (href === undefined) return '';
          links++;
          ok(isSafeHref(decodeXMLEntities(href)), `iteration ${i}: ${href}`);
          return '';
        });
        ok(!stripped.includes('<') && !stripped.includes('>'), `iteration ${i}: ${html}`);
        text += stripped.length;
      }
    }
    ok(links > 0 && text > 0, 'the corpus renders links and text');
  });
});
