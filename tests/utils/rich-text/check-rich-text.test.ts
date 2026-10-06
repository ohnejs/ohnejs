import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText, RichTextList, RichTextRun } from '../../../src/utils/index.ts';

import { checkRichText, jsonDepthWithin, normalizeRichText } from '../../../src/utils/index.ts';
import { FIXTURES, PAGE, PERMISSIVE } from './fixtures.ts';

const FIFTH = '[0].items[0].list.items[0].list.items[0].list.items[0].list';

function paragraph(...content: RichTextRun[]): RichText {
  return [{ kind: 'paragraph', content }];
}

function nested(depth: number): RichTextList {
  const content: RichTextRun[] = [{ text: `level ${depth}`, marks: ['em'], link: { url: '/a' } }];
  if (depth === 1) return { kind: 'list', ordered: false, items: [{ content }] };
  return { kind: 'list', ordered: false, items: [{ content, list: nested(depth - 1) }] };
}

describe('checkRichText', () => {
  it('passes `[]`', () => {
    deepStrictEqual(checkRichText([]), []);
  });

  it('passes every normalized fixture under its options', () => {
    for (const { normalized, options } of FIXTURES) {
      deepStrictEqual(checkRichText(normalized, { ...PERMISSIVE, ...options }), []);
    }
  });

  it('accepts `href` and duplicate marks', () => {
    deepStrictEqual(
      checkRichText(
        paragraph({
          text: 'a',
          marks: ['em', 'em'],
          link: { url: '/a', href: '/b' } as RichTextRun['link'],
        }),
      ),
      [],
    );
  });

  it('refuses a value that is not an array', () => {
    for (const value of [undefined, null, 'a', {}, { kind: 'paragraph', content: [] }]) {
      deepStrictEqual(checkRichText(value), [{ path: '', key: 'validation.invalidValue' }]);
    }
  });

  it('refuses a block that is not an object', () => {
    deepStrictEqual(checkRichText([null, 'a', []]), [
      { path: '[0]', key: 'validation.invalidValue' },
      { path: '[1]', key: 'validation.invalidValue' },
      { path: '[2]', key: 'validation.invalidValue' },
    ]);
  });

  it('refuses an unknown `kind`', () => {
    deepStrictEqual(checkRichText([{ kind: 'aside', content: [] }, { kind: 1 }]), [
      { path: '[0].kind', key: 'validation.invalidValue' },
      { path: '[1].kind', key: 'validation.invalidValue' },
    ]);
  });

  it('requires each required key', () => {
    deepStrictEqual(
      checkRichText([
        { content: [] },
        { kind: 'paragraph' },
        { kind: 'heading', content: [] },
        { kind: 'list', items: [] },
        { kind: 'list', ordered: true },
        { kind: 'list', ordered: true, items: [{}] },
        { kind: 'paragraph', content: [{}] },
        { kind: 'paragraph', content: [{ text: 'a', link: { collection: 'Pages' } }] },
      ]),
      [
        { path: '[0].kind', key: 'validation.required' },
        { path: '[1].content', key: 'validation.required' },
        { path: '[2].level', key: 'validation.required' },
        { path: '[3].ordered', key: 'validation.required' },
        { path: '[4].items', key: 'validation.required' },
        { path: '[5].items[0].content', key: 'validation.required' },
        { path: '[6].content[0].text', key: 'validation.required' },
        { path: '[7].content[0].link.collection', key: 'validation.invalidChoice' },
        { path: '[7].content[0].link.record', key: 'validation.required' },
      ],
    );
  });

  it('refuses a known key with the wrong type', () => {
    deepStrictEqual(
      checkRichText([
        { kind: 'paragraph', content: 'a' },
        { kind: 'heading', level: 1, content: [] },
        { kind: 'heading', level: '2', content: [] },
        { kind: 'list', ordered: 'yes', items: [] },
        { kind: 'list', ordered: true, items: {} },
        { kind: 'list', ordered: true, items: [null, { content: [], list: 'a' }] },
        { kind: 'paragraph', content: [null, { text: 1, marks: 'em', link: 'https://x.y' }] },
      ]),
      [
        { path: '[0].content', key: 'validation.invalidValue' },
        { path: '[1].level', key: 'validation.invalidValue' },
        { path: '[2].level', key: 'validation.invalidValue' },
        { path: '[3].ordered', key: 'validation.invalidValue' },
        { path: '[4].items', key: 'validation.invalidValue' },
        { path: '[5].items[0]', key: 'validation.invalidValue' },
        { path: '[5].items[1].list', key: 'validation.invalidValue' },
        { path: '[6].content[0]', key: 'validation.invalidValue' },
        { path: '[6].content[1].text', key: 'validation.invalidValue' },
        { path: '[6].content[1].marks', key: 'validation.invalidValue' },
        { path: '[6].content[1].link', key: 'validation.invalidValue' },
      ],
    );
  });

  it('refuses a sublist whose `kind` is not `list`', () => {
    deepStrictEqual(
      checkRichText([
        {
          kind: 'list',
          ordered: true,
          items: [
            { content: [], list: { ordered: true, items: [] } },
            { content: [], list: { kind: 'paragraph', content: [] } },
          ],
        },
      ]),
      [
        { path: '[0].items[0].list.kind', key: 'validation.required' },
        { path: '[0].items[1].list.kind', key: 'validation.invalidValue' },
      ],
    );
  });

  it('refuses an unknown key on any node', () => {
    deepStrictEqual(
      checkRichText([
        {
          kind: 'paragraph',
          content: [{ text: 'a', style: 'b', link: { url: '/a', rel: 'c' } }],
          id: 1,
        },
        { kind: 'list', ordered: true, items: [{ content: [], checked: true }] },
      ]),
      [
        { path: '[0].id', key: 'validation.unknownField' },
        { path: '[0].content[0].style', key: 'validation.unknownField' },
        { path: '[0].content[0].link.rel', key: 'validation.unknownField' },
        { path: '[1].items[0].checked', key: 'validation.unknownField' },
      ],
    );
  });

  it('refuses a key that belongs to another kind', () => {
    deepStrictEqual(checkRichText([{ kind: 'paragraph', level: 2, content: [] }]), [
      { path: '[0].level', key: 'validation.unknownField' },
    ]);
  });

  it('refuses a heading level outside `elements` at the level', () => {
    deepStrictEqual(checkRichText([{ kind: 'heading', level: 4, content: [] }]), [
      { path: '[0].level', key: 'validation.invalidChoice' },
    ]);
  });

  it('refuses a heading at its kind when `elements` allows no heading', () => {
    deepStrictEqual(
      checkRichText([{ kind: 'heading', level: 2, content: [] }], { elements: ['ul'] }),
      [{ path: '[0].kind', key: 'validation.invalidChoice' }],
    );
  });

  it('refuses a list type outside `elements` at `ordered`', () => {
    deepStrictEqual(
      checkRichText([{ kind: 'list', ordered: true, items: [{ content: [] }] }], {
        elements: ['ul'],
      }),
      [{ path: '[0].ordered', key: 'validation.invalidChoice' }],
    );
  });

  it('refuses a nested list type outside `elements`', () => {
    deepStrictEqual(
      checkRichText(
        [
          {
            kind: 'list',
            ordered: false,
            items: [
              { content: [], list: { kind: 'list', ordered: true, items: [{ content: [] }] } },
            ],
          },
        ],
        { elements: ['ul'] },
      ),
      [{ path: '[0].items[0].list.ordered', key: 'validation.invalidChoice' }],
    );
  });

  it('refuses a list at its kind when `elements` allows no list', () => {
    deepStrictEqual(
      checkRichText([{ kind: 'list', ordered: false, items: [] }], { elements: ['h2'] }),
      [{ path: '[0].kind', key: 'validation.invalidChoice' }],
    );
  });

  it('refuses a quote outside `elements`', () => {
    deepStrictEqual(checkRichText([{ kind: 'quote', content: [] }], { elements: [] }), [
      { path: '[0].kind', key: 'validation.invalidChoice' },
    ]);
  });

  it('always allows a paragraph', () => {
    deepStrictEqual(checkRichText(paragraph({ text: 'a' }), { elements: [], inline: true }), []);
  });

  it('refuses any block other than a paragraph under `inline`', () => {
    for (const block of [
      { kind: 'heading', level: 2, content: [] },
      { kind: 'quote', content: [] },
      { kind: 'list', ordered: false, items: [] },
    ]) {
      deepStrictEqual(checkRichText([block], { inline: true }), [
        { path: '[0].kind', key: 'validation.invalidChoice' },
      ]);
    }
  });

  it('refuses a second block under `inline`, and nothing after it', () => {
    deepStrictEqual(
      checkRichText([...paragraph({ text: 'a' }), ...paragraph({ text: 'b' }), null], {
        inline: true,
      }),
      [{ path: '[1]', key: 'validation.singleParagraph' }],
    );
  });

  it('passes a list four levels deep', () => {
    deepStrictEqual(checkRichText([nested(4)]), []);
  });

  it('refuses a fifth level at that list', () => {
    deepStrictEqual(checkRichText([nested(5)]), [
      { path: FIFTH, key: 'validation.maxDepth', params: { max: 4 } },
    ]);
  });

  it('keeps a valid value four levels deep within a JSON depth of 32', () => {
    strictEqual(jsonDepthWithin(JSON.stringify([nested(4)]), 32), true);
  });

  it('refuses a mark name that is not one of the marks', () => {
    deepStrictEqual(
      checkRichText(paragraph({ text: 'a', marks: ['u', 1] } as unknown as RichTextRun)),
      [
        { path: '[0].content[0].marks[0]', key: 'validation.invalidValue' },
        { path: '[0].content[0].marks[1]', key: 'validation.invalidValue' },
      ],
    );
  });

  it('refuses a mark that `marks` does not allow', () => {
    deepStrictEqual(checkRichText(paragraph({ text: 'a', marks: ['strong', 'del'] })), [
      { path: '[0].content[0].marks[1]', key: 'validation.invalidChoice' },
    ]);
  });

  it('refuses any link under `links: false`', () => {
    deepStrictEqual(
      checkRichText(paragraph({ text: 'a', link: { url: '/a' } }), { links: false }),
      [{ path: '[0].content[0].link', key: 'validation.linksNotAllowed' }],
    );
  });

  it('refuses a link with neither `collection` nor `url`', () => {
    deepStrictEqual(checkRichText(paragraph({ text: 'a', link: {} } as unknown as RichTextRun)), [
      { path: '[0].content[0].link', key: 'validation.invalidValue' },
    ]);
  });

  it('refuses a record link into a collection that is not allowed', () => {
    deepStrictEqual(
      checkRichText(paragraph({ text: 'a', link: { collection: 'Users', record: PAGE } }), {
        links: ['Pages'],
      }),
      [{ path: '[0].content[0].link.collection', key: 'validation.invalidChoice' }],
    );
  });

  it('refuses a `record` that is not a `UUID`', () => {
    deepStrictEqual(
      checkRichText(paragraph({ text: 'a', link: { collection: 'Pages', record: 'x' } }), {
        links: ['Pages'],
      }),
      [{ path: '[0].content[0].link.record', key: 'validation.invalidValue' }],
    );
  });

  it('refuses a `hash` holding whitespace, `#` or a control character', () => {
    deepStrictEqual(
      checkRichText(
        paragraph({ text: 'a', link: { collection: 'Pages', record: PAGE, hash: '#a' } }),
        {
          links: ['Pages'],
        },
      ),
      [{ path: '[0].content[0].link.hash', key: 'validation.invalidValue' }],
    );
  });

  it('refuses a `url` that fails `isSafeHref`', () => {
    deepStrictEqual(checkRichText(paragraph({ text: 'a', link: { url: 'javascript:alert(1)' } })), [
      { path: '[0].content[0].link.url', key: 'validation.invalidLink' },
    ]);
  });

  it('applies the defaults', () => {
    deepStrictEqual(
      checkRichText([
        { kind: 'heading', level: 2, content: [{ text: 'a', marks: ['strong', 'em', 'code'] }] },
        { kind: 'heading', level: 3, content: [{ text: 'a', link: { url: 'https://x.y' } }] },
        { kind: 'heading', level: 4, content: [] },
        { kind: 'list', ordered: true, items: [{ content: [{ text: 'a', marks: ['del'] }] }] },
        { kind: 'quote', content: [{ text: 'a', link: { collection: 'Pages', record: PAGE } }] },
      ]),
      [
        { path: '[2].level', key: 'validation.invalidChoice' },
        { path: '[3].items[0].content[0].marks[0]', key: 'validation.invalidChoice' },
        { path: '[4].content[0].link.collection', key: 'validation.invalidChoice' },
      ],
    );
  });

  it('collects issues in document order, a node before its children', () => {
    deepStrictEqual(
      checkRichText(
        [
          {
            kind: 'list',
            ordered: true,
            items: [
              {
                content: [{ text: 'a', marks: ['del'] }],
                list: { kind: 'list', ordered: true, items: [null] },
              },
              { content: [{ text: 1 }] },
            ],
            extra: true,
          },
          { kind: 'heading', level: 5, content: [{ text: 'b', link: { url: 'data:x' } }] },
        ],
        { elements: ['ul', 'h2'] },
      ),
      [
        { path: '[0].ordered', key: 'validation.invalidChoice' },
        { path: '[0].extra', key: 'validation.unknownField' },
        { path: '[0].items[0].content[0].marks[0]', key: 'validation.invalidChoice' },
        { path: '[0].items[0].list.ordered', key: 'validation.invalidChoice' },
        { path: '[0].items[0].list.items[0]', key: 'validation.invalidValue' },
        { path: '[0].items[1].content[0].text', key: 'validation.invalidValue' },
        { path: '[1].level', key: 'validation.invalidChoice' },
        { path: '[1].content[0].link.url', key: 'validation.invalidLink' },
      ],
    );
  });

  it("reports a node's scalar keys, then its unknown keys, then its children", () => {
    deepStrictEqual(
      checkRichText([
        { kind: 'paragraph', content: [{ text: 1, marks: ['u'], link: { url: 1 }, zzz: 1 }] },
        { kind: 'list', ordered: true, items: [{ zzz: 1 }] },
      ]),
      [
        { path: '[0].content[0].text', key: 'validation.invalidValue' },
        { path: '[0].content[0].zzz', key: 'validation.unknownField' },
        { path: '[0].content[0].marks[0]', key: 'validation.invalidValue' },
        { path: '[0].content[0].link.url', key: 'validation.invalidValue' },
        { path: '[1].items[0].zzz', key: 'validation.unknownField' },
        { path: '[1].items[0].content', key: 'validation.required' },
      ],
    );
  });

  it('reports at most one issue per path', () => {
    const issues = checkRichText(
      [
        {
          kind: 'heading',
          level: 9,
          content: [{ text: 'a', marks: ['u', 'del'], link: { url: 'x', newTab: 1 } }],
        },
        { kind: 'list', ordered: 'x', items: [{ content: [], list: nested(5) }] },
      ],
      { elements: [], marks: [], links: false },
    );
    strictEqual(new Set(issues.map((issue) => issue.path)).size, issues.length);
  });

  it('reads a key holding `undefined` as absent', () => {
    deepStrictEqual(checkRichText(paragraph({ text: 'a', marks: undefined, link: undefined })), []);
    deepStrictEqual(checkRichText([{ kind: 'paragraph', content: undefined }]), [
      { path: '[0].content', key: 'validation.required' },
    ]);
  });

  it('never throws', () => {
    const cyclic: Record<string, unknown> = { kind: 'list', ordered: true };
    cyclic.items = [{ content: [], list: cyclic }];
    for (const value of [
      undefined,
      NaN,
      Symbol('x'),
      () => {},
      new Map(),
      [new Date()],
      [cyclic],
      [Object.create(null)],
    ]) {
      doesNotThrow(() => checkRichText(value));
    }
  });

  it('checks values that normalize would fix as they are', () => {
    const value = paragraph({ text: 'a', link: { url: ' https://x.y' } });
    deepStrictEqual(checkRichText(value), [
      { path: '[0].content[0].link.url', key: 'validation.invalidLink' },
    ]);
    deepStrictEqual(checkRichText(normalizeRichText(value)), []);
  });
});
