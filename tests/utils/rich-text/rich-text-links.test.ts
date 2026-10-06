import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText, RichTextList, RichTextRun } from '../../../src/utils/index.ts';

import { richTextLinks } from '../../../src/utils/index.ts';
import { PAGE } from './fixtures.ts';

function paragraph(...content: RichTextRun[]): RichText {
  return [{ kind: 'paragraph', content }];
}

function nested(depth: number): RichTextList {
  const content: RichTextRun[] = [{ text: `level ${depth}`, link: { url: `/${depth}` } }];
  if (depth === 1) return { kind: 'list', ordered: false, items: [{ content }] };
  return { kind: 'list', ordered: false, items: [{ content, list: nested(depth - 1) }] };
}

describe('richTextLinks', () => {
  it('gives `[]` for `[]`', () => {
    deepStrictEqual(richTextLinks([]), []);
  });

  it('lists links in document order, at the paths `checkRichText` uses', () => {
    deepStrictEqual(
      richTextLinks([
        { kind: 'heading', level: 2, content: [{ text: 'a', link: { url: '/a' } }] },
        {
          kind: 'paragraph',
          content: [{ text: 'plain' }, { text: 'b', marks: ['em'], link: { url: '/b' } }],
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            {
              content: [{ text: 'c', link: { url: '/c' } }],
              list: {
                kind: 'list',
                ordered: false,
                items: [{ content: [{ text: 'd', link: { url: '/d' } }] }],
              },
            },
            { content: [{ text: 'e', link: { url: '/e' } }] },
          ],
        },
        { kind: 'quote', content: [{ text: 'f', link: { url: '/f' } }] },
      ]),
      [
        { path: '[0].content[0].link', link: { url: '/a' } },
        { path: '[1].content[1].link', link: { url: '/b' } },
        { path: '[2].items[0].content[0].link', link: { url: '/c' } },
        { path: '[2].items[0].list.items[0].content[0].link', link: { url: '/d' } },
        { path: '[2].items[1].content[0].link', link: { url: '/e' } },
        { path: '[3].content[0].link', link: { url: '/f' } },
      ],
    );
  });

  it('returns each link by reference', () => {
    const link = { collection: 'Pages', record: PAGE };
    const [found] = richTextLinks(paragraph({ text: 'a', link }));
    strictEqual(found?.link, link);
  });

  it('lists record links and URL links alike, with whatever they carry', () => {
    const record = { collection: 'Pages', record: PAGE, hash: 'top', newTab: true, href: '/p' };
    const url = { url: 'https://x.y', newTab: false, href: '/forged' };
    deepStrictEqual(
      richTextLinks(paragraph({ text: 'a', link: record }, { text: 'b', link: url })),
      [
        { path: '[0].content[0].link', link: record },
        { path: '[0].content[1].link', link: url },
      ],
    );
  });

  it('judges a link by its shape only, never by what options allow', () => {
    deepStrictEqual(
      richTextLinks(
        paragraph(
          { text: 'a', link: { url: ' javascript:alert(1) ' } },
          { text: 'b', link: { collection: 'Users', record: PAGE, hash: '#x' } },
        ),
      ),
      [
        { path: '[0].content[0].link', link: { url: ' javascript:alert(1) ' } },
        { path: '[0].content[1].link', link: { collection: 'Users', record: PAGE, hash: '#x' } },
      ],
    );
  });

  it('skips runs without a link', () => {
    deepStrictEqual(richTextLinks(paragraph({ text: 'a' }, { text: 'b', marks: ['em'] })), []);
  });

  it('skips a link that is not shaped like one', () => {
    for (const link of [
      null,
      'https://x.y',
      1,
      { url: 1 },
      { collection: 'Pages', record: 'home' },
      { collection: 'Pages' },
      { url: 'https://x.y', rel: 'nofollow' },
      { url: 'https://x.y', newTab: 'yes' },
      {},
    ]) {
      deepStrictEqual(
        richTextLinks([{ kind: 'paragraph', content: [{ text: 'a', link }] }]),
        [],
        JSON.stringify(link),
      );
    }
  });

  it('gives `[]` for a value that is not an array', () => {
    for (const value of [null, undefined, 'a', 1, {}, { kind: 'paragraph', content: [] }]) {
      deepStrictEqual(richTextLinks(value), []);
    }
  });

  it('skips blocks, items and runs it cannot read, and keeps the rest', () => {
    deepStrictEqual(
      richTextLinks([
        null,
        'x',
        { kind: 'aside', content: [{ text: 'a', link: { url: '/a' } }] },
        { kind: 'paragraph', content: 'b' },
        {
          kind: 'paragraph',
          content: [null, { link: { url: '/c' } }, { text: 'd', link: { url: '/d' } }],
        },
        { kind: 'list', ordered: true, items: 'x' },
        {
          kind: 'list',
          ordered: true,
          items: [1, { content: [{ text: 'e', link: { url: '/e' } }] }],
        },
        { kind: 'list', ordered: true, items: [{ content: [], list: 'x' }] },
      ]),
      [
        { path: '[4].content[2].link', link: { url: '/d' } },
        { path: '[6].items[1].content[0].link', link: { url: '/e' } },
      ],
    );
  });

  it('skips a nested list whose `kind` is not `list`', () => {
    deepStrictEqual(
      richTextLinks([
        {
          kind: 'list',
          ordered: false,
          items: [
            {
              content: [{ text: 'a', link: { url: '/a' } }],
              list: { kind: 'aside', items: [{ content: [{ text: 'b', link: { url: '/b' } }] }] },
            },
          ],
        },
      ]),
      [{ path: '[0].items[0].content[0].link', link: { url: '/a' } }],
    );
  });

  it('reads a list four levels deep, and stops below it', () => {
    deepStrictEqual(
      richTextLinks([nested(4)]).map((entry) => entry.link),
      [{ url: '/4' }, { url: '/3' }, { url: '/2' }, { url: '/1' }],
    );
    deepStrictEqual(
      richTextLinks([nested(5)]).map((entry) => entry.link),
      [{ url: '/5' }, { url: '/4' }, { url: '/3' }, { url: '/2' }],
    );
  });

  it('never throws on malformed input', () => {
    for (const value of [
      [
        {
          kind: 'list',
          ordered: true,
          items: [{ content: [{ text: 'a', link: Object.create(null) }] }],
        },
      ],
      [{ kind: 'paragraph', content: [{ text: 'a', link: { __proto__: null, url: '/a' } }] }],
      [{ kind: 'list', items: [{ list: { items: [{ content: [[]] }] } }] }],
      [{ kind: 'heading', content: [{ text: {} }] }],
    ]) {
      doesNotThrow(() => richTextLinks(value));
    }
  });
});
