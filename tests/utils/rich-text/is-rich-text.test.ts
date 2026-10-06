import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRichText } from '../../../src/utils/index.ts';
import { FIXTURES, PAGE } from './fixtures.ts';

function nested(depth: number): unknown {
  const content = [{ text: 'a' }];
  if (depth === 1) return { kind: 'list', ordered: false, items: [{ content }] };
  return { kind: 'list', ordered: false, items: [{ content, list: nested(depth - 1) }] };
}

describe('isRichText', () => {
  it('accepts every fixture, before and after normalize', () => {
    for (const { input, normalized } of FIXTURES) {
      strictEqual(isRichText(input), true);
      strictEqual(isRichText(normalized), true);
    }
  });

  it('accepts a value that is well shaped but not allowed', () => {
    strictEqual(
      isRichText([
        { kind: 'heading', level: 6, content: [{ text: 'a', marks: ['del', 'del', 'code'] }] },
        {
          kind: 'quote',
          content: [{ text: 'b', link: { collection: 'Users', record: PAGE, hash: '#a b' } }],
        },
        { kind: 'paragraph', content: [{ text: 'c', link: { url: 'javascript:alert(1)' } }] },
        {
          kind: 'paragraph',
          content: [{ text: 'd', link: { url: ' /a ', href: '/b', newTab: false } }],
        },
      ]),
      true,
    );
  });

  it('accepts a list four levels deep and refuses a fifth level', () => {
    strictEqual(isRichText([nested(4)]), true);
    strictEqual(isRichText([nested(5)]), false);
  });

  it('refuses an unknown key', () => {
    strictEqual(
      isRichText([{ kind: 'paragraph', content: [{ text: 'a', style: 'bold' }] }]),
      false,
    );
    strictEqual(isRichText([{ kind: 'paragraph', content: [], id: 1 }]), false);
    strictEqual(
      isRichText([{ kind: 'paragraph', content: [{ text: 'a', link: { url: '/a', rel: 'x' } }] }]),
      false,
    );
  });

  it('refuses an unknown kind or a mark name that does not exist', () => {
    strictEqual(isRichText([{ kind: 'aside', content: [] }]), false);
    strictEqual(isRichText([{ kind: 'paragraph', content: [{ text: 'a', marks: ['u'] }] }]), false);
  });

  it('refuses a missing or mistyped key', () => {
    strictEqual(isRichText([{ kind: 'paragraph' }]), false);
    strictEqual(isRichText([{ kind: 'heading', level: 1, content: [] }]), false);
    strictEqual(isRichText([{ kind: 'list', ordered: 1, items: [] }]), false);
    strictEqual(isRichText([{ kind: 'paragraph', content: [{ text: null }] }]), false);
    strictEqual(
      isRichText([
        { kind: 'paragraph', content: [{ text: 'a', link: { collection: 'Pages', record: 'x' } }] },
      ]),
      false,
    );
  });

  it('refuses a value that is not an array', () => {
    for (const value of [undefined, null, '', 'a', {}, 1]) strictEqual(isRichText(value), false);
  });

  it('ignores the options: several blocks pass', () => {
    strictEqual(
      isRichText([
        { kind: 'paragraph', content: [] },
        { kind: 'paragraph', content: [] },
      ]),
      true,
    );
  });
});
