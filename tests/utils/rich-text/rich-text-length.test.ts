import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichText } from '../../../src/utils/index.ts';

import { richTextLength, richTextToText } from '../../../src/utils/index.ts';

describe('richTextLength', () => {
  it('gives 0 for `[]`', () => {
    strictEqual(richTextLength([]), 0);
  });

  it('sums run text across blocks and nested items', () => {
    strictEqual(
      richTextLength([
        { kind: 'heading', level: 2, content: [{ text: 'ab' }] },
        {
          kind: 'list',
          ordered: false,
          items: [
            {
              content: [{ text: 'c' }, { text: 'd', marks: ['em'] }],
              list: { kind: 'list', ordered: true, items: [{ content: [{ text: 'ef' }] }] },
            },
          ],
        },
        { kind: 'quote', content: [{ text: 'g', link: { url: '/g' } }] },
      ]),
      7,
    );
  });

  it('counts `\\n` as 1 and a block boundary as 0', () => {
    strictEqual(
      richTextLength([
        { kind: 'paragraph', content: [{ text: 'a\nb' }] },
        { kind: 'paragraph', content: [{ text: 'c' }] },
      ]),
      4,
    );
  });

  it('counts UTF-16 code units, as `text.length` and `max` do', () => {
    strictEqual(richTextLength([{ kind: 'paragraph', content: [{ text: '\u{1F600}é' }] }]), 4);
  });

  it('agrees with the length of `richTextToText` for a single block', () => {
    const value: RichText = [{ kind: 'paragraph', content: [{ text: 'a\n b' }, { text: 'c' }] }];
    strictEqual(richTextLength(value), richTextToText(value).length);
  });
});
