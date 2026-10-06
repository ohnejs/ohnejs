import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { richTextToText } from '../../../src/utils/index.ts';
import { FIXTURES, PAGE } from './fixtures.ts';

describe('richTextToText', () => {
  it("gives `''` for `[]`", () => {
    strictEqual(richTextToText([]), '');
  });

  it('renders every normalized fixture', () => {
    for (const { name, normalized, text } of FIXTURES) {
      strictEqual(richTextToText(normalized), text, name);
    }
  });

  it('joins blocks with a blank line', () => {
    strictEqual(
      richTextToText([
        { kind: 'heading', level: 2, content: [{ text: 'Title' }] },
        { kind: 'paragraph', content: [{ text: 'Body' }] },
        { kind: 'quote', content: [{ text: 'Said' }] },
      ]),
      'Title\n\nBody\n\nSaid',
    );
  });

  it('keeps an empty block as an empty line', () => {
    strictEqual(
      richTextToText([
        { kind: 'paragraph', content: [{ text: 'a' }] },
        { kind: 'paragraph', content: [] },
        { kind: 'paragraph', content: [{ text: 'b' }] },
      ]),
      'a\n\n\n\nb',
    );
  });

  it('puts each list item on its own line, nested items included', () => {
    strictEqual(
      richTextToText([
        { kind: 'paragraph', content: [{ text: 'Steps' }] },
        {
          kind: 'list',
          ordered: true,
          items: [
            {
              content: [{ text: 'one' }],
              list: {
                kind: 'list',
                ordered: false,
                items: [{ content: [{ text: 'two' }] }, { content: [{ text: 'three' }] }],
              },
            },
            { content: [{ text: 'four' }] },
          ],
        },
        { kind: 'paragraph', content: [{ text: 'Done' }] },
      ]),
      'Steps\n\none\ntwo\nthree\nfour\n\nDone',
    );
  });

  it('keeps runs as they are, dropping marks and links', () => {
    strictEqual(
      richTextToText([
        {
          kind: 'paragraph',
          content: [
            { text: 'a \n', marks: ['strong', 'code'] },
            { text: ' b', link: { url: 'https://x.y', newTab: true } },
            { text: '<c>', link: { collection: 'Pages', record: PAGE, href: '/c' } },
          ],
        },
      ]),
      'a \n b<c>',
    );
  });
});
