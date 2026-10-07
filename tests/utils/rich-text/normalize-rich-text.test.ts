import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText, RichTextRun } from '../../../src/utils/index.ts';

import { normalizeRichText } from '../../../src/utils/index.ts';
import { FIXTURES, PAGE } from './fixtures.ts';

function runs(content: RichTextRun[], options = {}): RichTextRun[] {
  const [block] = normalizeRichText([{ kind: 'paragraph', content }], options);
  return block?.kind === 'paragraph' ? block.content : [];
}

describe('normalizeRichText', () => {
  for (const fixture of FIXTURES) {
    it(`normalizes the ${fixture.name} fixture`, () => {
      deepStrictEqual(normalizeRichText(fixture.input, fixture.options), fixture.normalized);
    });
  }

  it('gives the same result when run twice, across the fixtures', () => {
    for (const { input, options } of FIXTURES) {
      const once = normalizeRichText(input, options);
      deepStrictEqual(normalizeRichText(once, options), once);
    }
  });

  it('never mutates its input', () => {
    for (const { input, options } of FIXTURES) {
      const before = structuredClone(input);
      normalizeRichText(input, options);
      deepStrictEqual(input, before);
    }
  });

  it('shares no node with its input', () => {
    const input: RichText = [{ kind: 'paragraph', content: [{ text: 'a', link: { url: '/a' } }] }];
    const [block] = normalizeRichText(input);
    if (block.kind !== 'paragraph') throw new Error('expected a paragraph');
    Object.assign(block.content[0].link ?? {}, { url: '/b' });
    block.content[0].text = 'b';
    deepStrictEqual(input, [{ kind: 'paragraph', content: [{ text: 'a', link: { url: '/a' } }] }]);
  });

  it('merges runs through `mergeRuns`', () => {
    deepStrictEqual(
      runs([
        { text: 'a', marks: ['em', 'strong'] },
        { text: '' },
        { text: 'b', marks: ['strong', 'em'] },
      ]),
      [{ text: 'ab', marks: ['strong', 'em'] }],
    );
  });

  it('normalizes links before merging', () => {
    deepStrictEqual(
      runs([
        { text: 'a', link: { url: ' /x', newTab: false } },
        { text: 'b', link: { url: '/x' } },
      ]),
      [{ text: 'ab', link: { url: '/x' } }],
    );
  });

  it('turns a lone surrogate into U+FFFD', () => {
    deepStrictEqual(runs([{ text: 'a\uDC00b\uD800' }]), [{ text: 'a�b�' }]);
  });

  it('keeps a surrogate pair split across equal runs', () => {
    deepStrictEqual(runs([{ text: 'a\uD83D' }, { text: '\uDE00b' }]), [{ text: 'a\u{1F600}b' }]);
  });

  it('turns `\\r\\n` and `\\r` into `\\n`', () => {
    deepStrictEqual(runs([{ text: 'a\r\nb\rc' }]), [{ text: 'a\nb\nc' }]);
  });

  it('reads `\\r\\n` split across equal runs as one break', () => {
    deepStrictEqual(runs([{ text: 'a\r' }, { text: '\nb' }]), [{ text: 'a\nb' }]);
  });

  it('removes every control character except `\\n` and `\\t`', () => {
    deepStrictEqual(runs([{ text: 'a\u0000\u0007\u001b\u007f\u0085\u009fb\tc\nd' }]), [
      { text: 'ab\tc\nd' },
    ]);
  });

  it('merges neighbours that a removed control run kept apart', () => {
    deepStrictEqual(runs([{ text: 'a' }, { text: '\u0000', marks: ['em'] }, { text: 'b' }]), [
      { text: 'ab' },
    ]);
  });

  it('turns `\\n` into a space under `lineBreaks: false`', () => {
    deepStrictEqual(runs([{ text: 'a\nb\r\nc' }], { lineBreaks: false }), [{ text: 'a b c' }]);
  });

  it('composes to NFC after merging', () => {
    deepStrictEqual(
      runs([
        { text: 'e', marks: ['em'] },
        { text: '́', marks: ['em'] },
      ]),
      [{ text: 'é', marks: ['em'] }],
    );
  });

  it('never composes across runs with different marks', () => {
    deepStrictEqual(runs([{ text: 'e', marks: ['em'] }, { text: '́' }]), [
      { text: 'e', marks: ['em'] },
      { text: '́' },
    ]);
  });

  it('trims `\\n` at the start and end of each leaf, across runs', () => {
    deepStrictEqual(
      runs([
        { text: '\n', marks: ['em'] },
        { text: '\n a' },
        { text: 'b \n', marks: ['em'] },
        { text: '\n' },
      ]),
      [{ text: ' a' }, { text: 'b ', marks: ['em'] }],
    );
  });

  it('never trims spaces', () => {
    deepStrictEqual(runs([{ text: '  a  ' }]), [{ text: '  a  ' }]);
  });

  it('keeps whitespace-only text', () => {
    deepStrictEqual(runs([{ text: ' ' }]), [{ text: ' ' }]);
  });

  it('trims the leaf of a heading, a quote and a list item', () => {
    deepStrictEqual(
      normalizeRichText([
        { kind: 'heading', level: 3, content: [{ text: '\na\n' }] },
        { kind: 'quote', content: [{ text: '\nb\n' }] },
        { kind: 'list', ordered: false, items: [{ content: [{ text: '\nc\n' }] }] },
      ]),
      [
        { kind: 'heading', level: 3, content: [{ text: 'a' }] },
        { kind: 'quote', content: [{ text: 'b' }] },
        { kind: 'list', ordered: false, items: [{ content: [{ text: 'c' }] }] },
      ],
    );
  });

  it('drops an item with no runs and no sublist, an empty sublist and an empty list', () => {
    deepStrictEqual(
      normalizeRichText([
        {
          kind: 'list',
          ordered: false,
          items: [
            { content: [{ text: '\n' }] },
            {
              content: [{ text: 'a' }],
              list: { kind: 'list', ordered: true, items: [{ content: [] }] },
            },
          ],
        },
        {
          kind: 'list',
          ordered: true,
          items: [{ content: [], list: { kind: 'list', ordered: true, items: [] } }],
        },
        { kind: 'paragraph', content: [{ text: 'b' }] },
      ]),
      [
        { kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }] },
        { kind: 'paragraph', content: [{ text: 'b' }] },
      ],
    );
  });

  it('keeps an item with no runs that holds a sublist', () => {
    const value: RichText = [
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            content: [],
            list: { kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }] },
          },
        ],
      },
    ];
    deepStrictEqual(normalizeRichText(value), value);
  });

  it('drops empty blocks only at the end of the value', () => {
    deepStrictEqual(
      normalizeRichText([
        { kind: 'paragraph', content: [] },
        { kind: 'heading', level: 2, content: [{ text: '' }] },
        { kind: 'paragraph', content: [{ text: 'a' }] },
        { kind: 'quote', content: [] },
        { kind: 'heading', level: 2, content: [] },
        { kind: 'paragraph', content: [{ text: '\n\n' }] },
      ]),
      [
        { kind: 'paragraph', content: [] },
        { kind: 'heading', level: 2, content: [] },
        { kind: 'paragraph', content: [{ text: 'a' }] },
      ],
    );
  });

  it('turns a value of empty blocks into []', () => {
    deepStrictEqual(normalizeRichText([{ kind: 'paragraph', content: [{ text: '\n' }] }]), []);
  });

  it('never merges adjacent lists', () => {
    const value: RichText = [
      { kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }] },
      { kind: 'list', ordered: false, items: [{ content: [{ text: 'b' }] }] },
    ];
    deepStrictEqual(normalizeRichText(value), value);
  });

  it('drops keys holding `undefined`', () => {
    deepStrictEqual(
      normalizeRichText([
        {
          kind: 'paragraph',
          content: [
            {
              text: 'a',
              marks: undefined,
              link: { collection: 'Pages', record: PAGE, hash: undefined },
            },
          ],
        },
      ]),
      [
        {
          kind: 'paragraph',
          content: [{ text: 'a', link: { collection: 'Pages', record: PAGE } }],
        },
      ],
    );
  });

  it('trims a long run of `\\n` in linear time', () => {
    const text = `${'\n'.repeat(200_000)}x${'\n'.repeat(200_000)}`;
    const start = performance.now();
    deepStrictEqual(normalizeRichText([{ kind: 'paragraph', content: [{ text }] }]), [
      { kind: 'paragraph', content: [{ text: 'x' }] },
    ]);
    ok(performance.now() - start < 1000);
  });
});
