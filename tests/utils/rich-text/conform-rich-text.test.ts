import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  RichText,
  RichTextList,
  RichTextOptions,
  RichTextRun,
} from '../../../src/utils/index.ts';

import { checkRichText, conformRichText } from '../../../src/utils/index.ts';
import { FIXTURES, PAGE, PERMISSIVE } from './fixtures.ts';

const PARAGRAPHS_ONLY: RichTextOptions = { elements: [] };

function paragraph(...content: RichTextRun[]): RichText[number] {
  return { kind: 'paragraph', content };
}

function heading(level: 2 | 3 | 4 | 5 | 6, ...content: RichTextRun[]): RichText[number] {
  return { kind: 'heading', level, content };
}

function nested(depth: number, ordered = false): RichTextList {
  const content: RichTextRun[] = [{ text: `${depth}` }];
  if (depth === 1) return { kind: 'list', ordered, items: [{ content }] };
  return { kind: 'list', ordered, items: [{ content, list: nested(depth - 1, ordered) }] };
}

describe('conformRichText', () => {
  it('leaves every normalized fixture alone under its options', () => {
    for (const { normalized, options } of FIXTURES) {
      deepStrictEqual(conformRichText(normalized, { ...PERMISSIVE, ...options }), normalized);
    }
  });

  it('moves a heading to the nearest allowed level, the higher heading on a tie', () => {
    const value = [heading(2, { text: 'a' }), heading(4, { text: 'b' }), heading(6, { text: 'c' })];
    deepStrictEqual(conformRichText(value, { elements: ['h3', 'h5'] }), [
      heading(3, { text: 'a' }),
      heading(3, { text: 'b' }),
      heading(5, { text: 'c' }),
    ]);
    deepStrictEqual(conformRichText(value, { elements: ['h5'] }), [
      heading(5, { text: 'a' }),
      heading(5, { text: 'b' }),
      heading(5, { text: 'c' }),
    ]);
  });

  it('turns a heading into a paragraph when no level is allowed', () => {
    deepStrictEqual(conformRichText([heading(2, { text: 'a' })], { elements: ['ul'] }), [
      paragraph({ text: 'a' }),
    ]);
  });

  it('flips a list to the allowed type, nested lists included', () => {
    deepStrictEqual(conformRichText([nested(2, true)], { elements: ['ul'] }), [nested(2)]);
    deepStrictEqual(conformRichText([nested(2)], { elements: ['ol'] }), [nested(2, true)]);
  });

  it('turns a list into one paragraph per item when no list is allowed', () => {
    deepStrictEqual(conformRichText([nested(3)], PARAGRAPHS_ONLY), [
      paragraph({ text: '3' }),
      paragraph({ text: '2' }),
      paragraph({ text: '1' }),
    ]);
  });

  it('turns a disallowed quote into a paragraph', () => {
    deepStrictEqual(
      conformRichText([{ kind: 'quote', content: [{ text: 'a' }] }], PARAGRAPHS_ONLY),
      [paragraph({ text: 'a' })],
    );
  });

  it('drops disallowed marks and merges what is left', () => {
    deepStrictEqual(
      conformRichText(
        [
          paragraph(
            { text: 'a', marks: ['strong', 'del'] },
            { text: 'b', marks: ['strong'] },
            { text: 'c', marks: ['code'] },
          ),
        ],
        { marks: ['strong'] },
      ),
      [paragraph({ text: 'ab', marks: ['strong'] }, { text: 'c' })],
    );
  });

  it('keeps the text of a disallowed link', () => {
    const record: RichTextRun['link'] = { collection: 'Pages', record: PAGE };
    const url: RichTextRun['link'] = { url: 'https://x.y' };
    const value = [paragraph({ text: 'a', link: record }, { text: 'b', link: url })];
    deepStrictEqual(conformRichText(value, { links: false }), [paragraph({ text: 'ab' })]);
    deepStrictEqual(conformRichText(value, { links: true }), [
      paragraph({ text: 'a' }, { text: 'b', link: url }),
    ]);
    deepStrictEqual(conformRichText(value, { links: ['Posts'] }), [
      paragraph({ text: 'a' }, { text: 'b', link: url }),
    ]);
    deepStrictEqual(conformRichText(value, { links: ['Pages'] }), value);
    deepStrictEqual(conformRichText([paragraph({ text: 'c', link: { url: 'javascript:x' } })]), [
      paragraph({ text: 'c' }),
    ]);
  });

  it('lifts items deeper than lists may nest to the deepest level', () => {
    deepStrictEqual(conformRichText([nested(6)], PERMISSIVE), [
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            content: [{ text: '6' }],
            list: {
              kind: 'list',
              ordered: false,
              items: [
                {
                  content: [{ text: '5' }],
                  list: {
                    kind: 'list',
                    ordered: false,
                    items: [
                      {
                        content: [{ text: '4' }],
                        list: {
                          kind: 'list',
                          ordered: false,
                          items: [
                            { content: [{ text: '3' }] },
                            { content: [{ text: '2' }] },
                            { content: [{ text: '1' }] },
                          ],
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
    ]);
  });

  it('joins every leaf into one paragraph under `inline`', () => {
    const value: RichText = [
      heading(2, { text: 'a', marks: ['em'] }),
      nested(2),
      { kind: 'quote', content: [{ text: 'b' }] },
    ];
    deepStrictEqual(conformRichText(value, { inline: true }), [
      paragraph({ text: 'a', marks: ['em'] }, { text: '\n2\n1\nb' }),
    ]);
    deepStrictEqual(conformRichText(value, { inline: true, lineBreaks: false }), [
      paragraph({ text: 'a', marks: ['em'] }, { text: ' 2 1 b' }),
    ]);
    deepStrictEqual(conformRichText([], { inline: true }), []);
    deepStrictEqual(conformRichText([paragraph()], { inline: true }), [paragraph()]);
  });

  it('returns a new tree and never mutates its input', () => {
    const value: RichText = [heading(4, { text: 'a', marks: ['del'] })];
    const copy = structuredClone(value);
    const result = conformRichText(value, { elements: ['h2'], marks: [] });
    notStrictEqual(result, value);
    deepStrictEqual(value, copy);
  });

  it('gives a value that passes `checkRichText` under the same options', () => {
    const value: RichText = [
      heading(6, { text: 'a', marks: ['strong', 'em', 'del', 'code'], link: { url: '/a' } }),
      { kind: 'quote', content: [{ text: 'b', link: { collection: 'Pages', record: PAGE } }] },
      nested(6, true),
      paragraph({ text: 'c', link: { url: 'javascript:x' } }),
    ];
    const cases: RichTextOptions[] = [
      {},
      PERMISSIVE,
      PARAGRAPHS_ONLY,
      { elements: ['h3', 'ol'], marks: [], links: false },
      { elements: ['ul'], links: ['Posts'] },
      { inline: true },
      { inline: true, lineBreaks: false, links: false },
    ];
    for (const options of cases) {
      deepStrictEqual(checkRichText(conformRichText(value, options), options), []);
    }
  });
});
