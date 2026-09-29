import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseProse } from '../../../src/dashboard/ui/_prose-model.ts';

describe('parseProse', () => {
  it('parses bold, code, and an http link inside a paragraph', () => {
    deepStrictEqual(parseProse('A **b** `c` [d](https://e.test)', true), [
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'A ' },
          { kind: 'strong', text: 'b' },
          { kind: 'text', text: ' ' },
          { kind: 'code', text: 'c' },
          { kind: 'text', text: ' ' },
          { kind: 'link', text: 'd', href: 'https://e.test' },
        ],
      },
    ]);
  });

  it('parses a link as its label text with links off, merged into the text around it', () => {
    deepStrictEqual(parseProse('See [the docs](https://e.test).', false), [
      { kind: 'paragraph', content: [{ kind: 'text', text: 'See the docs.' }] },
    ]);
  });

  it('keeps a non-http link literal whether links are on or off', () => {
    const literal = [
      { kind: 'paragraph', content: [{ kind: 'text', text: 'a [x](javascript:y) b' }] },
    ];
    deepStrictEqual(parseProse('a [x](javascript:y) b', true), literal);
    deepStrictEqual(parseProse('a [x](javascript:y) b', false), literal);
  });

  it('turns links off inside quotes and table cells too', () => {
    deepStrictEqual(parseProse('> [a](https://e.test)\n\n| [b](https://e.test) |\n|-|', false), [
      { kind: 'quote', content: [{ kind: 'text', text: 'a' }] },
      { kind: 'table', head: [[{ kind: 'text', text: 'b' }]], rows: [] },
    ]);
  });

  it('breaks lines inside a paragraph and splits blocks on blank lines', () => {
    deepStrictEqual(parseProse('a\nb\n\nc', true), [
      {
        kind: 'paragraph',
        content: [{ kind: 'text', text: 'a' }, { kind: 'break' }, { kind: 'text', text: 'b' }],
      },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'c' }] },
    ]);
  });

  it('keeps a code fence verbatim, links included', () => {
    deepStrictEqual(parseProse('a\n```ts\n**[x](https://e.test)**\n```\nb', true), [
      { kind: 'paragraph', content: [{ kind: 'text', text: 'a' }] },
      { kind: 'code', text: '**[x](https://e.test)**\n' },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  it('drops the head of a table whose header cells are all empty', () => {
    deepStrictEqual(parseProse('|||\n|-|-|\n| a | b |', true), [
      {
        kind: 'table',
        head: null,
        rows: [[[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]]],
      },
    ]);
  });

  it('reads pipe lines without a separator row as a paragraph', () => {
    deepStrictEqual(parseProse('| a |\n| b |', true), [
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: '| a |' },
          { kind: 'break' },
          { kind: 'text', text: '| b |' },
        ],
      },
    ]);
  });
});
