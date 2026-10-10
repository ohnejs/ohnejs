import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { ProseBlock, ProseInline } from '../../../src/dashboard/ui/_prose-model.ts';

import { parseProse } from '../../../src/dashboard/ui/_prose-model.ts';
import { escapeControls } from '../../../src/utils/ansi/escape-controls.ts';
import { formatMessage } from '../../../src/utils/i18n/format-message.ts';

const text = (value: string): ProseInline => ({ kind: 'text', text: value });
const paragraph = (...content: ProseInline[]) => ({ kind: 'paragraph', content });

const inlineCodes = (runs: ProseInline[]): string[] =>
  runs.flatMap((run) => {
    if (run.kind === 'code') return [run.text];
    return 'content' in run ? inlineCodes(run.content) : [];
  });
const codeRuns = (blocks: ProseBlock[]): string[] =>
  blocks.flatMap((block) => {
    if (block.kind === 'table')
      return [...(block.head ?? []), ...block.rows.flat()].flatMap(inlineCodes);
    return 'content' in block ? inlineCodes(block.content) : [];
  });

describe('parseProse', () => {
  it('parses bold, code, and an http link inside a paragraph', () => {
    deepStrictEqual(parseProse('A **b** `c` [d](https://e.test)', true), [
      paragraph(
        text('A '),
        { kind: 'strong', content: [text('b')] },
        text(' '),
        { kind: 'code', text: 'c' },
        text(' '),
        { kind: 'link', href: 'https://e.test', local: false, content: [text('d')] },
      ),
    ]);
  });

  it('parses a link as its label text with links off, merged into the text around it', () => {
    deepStrictEqual(parseProse('See [the docs](https://e.test).', false), [
      paragraph(text('See the docs.')),
    ]);
  });

  it('parses a local link under true and local, and as its label with links off', () => {
    const link: ProseInline = {
      kind: 'link',
      href: '/collections/books',
      local: true,
      content: [text('Books')],
    };
    deepStrictEqual(parseProse('[Books](/collections/books)', true), [paragraph(link)]);
    deepStrictEqual(parseProse('[Books](/collections/books)', 'local'), [paragraph(link)]);
    deepStrictEqual(parseProse('[Books](/collections/books)', false), [paragraph(text('Books'))]);
  });

  it('parses an external link as its label under local', () => {
    deepStrictEqual(parseProse('a [b](https://e.test) c', 'local'), [paragraph(text('a b c'))]);
  });

  it('parses a javascript link as its label whether links are on or off', () => {
    deepStrictEqual(parseProse('a [x](javascript:y) b', true), [paragraph(text('a x b'))]);
    deepStrictEqual(parseProse('a [x](javascript:y) b', false), [paragraph(text('a x b'))]);
  });

  it('parses a link with userinfo as its label', () => {
    deepStrictEqual(parseProse('a [bank](https://bank.example@evil.example) b', true), [
      paragraph(text('a bank b')),
    ]);
  });

  it('parses a fragment, mailto, or tel link as its label, since only a web link opens a new tab', () => {
    deepStrictEqual(parseProse('a [t](#top) [m](mailto:a@b.c) [p](tel:1) b', true), [
      paragraph(text('a t m p b')),
    ]);
  });

  it('parses an image as its alt text', () => {
    deepStrictEqual(parseProse('a ![a cat](https://e.test/cat.png) b', true), [
      paragraph(text('a a cat b')),
    ]);
  });

  it('parses emphasis, strikethrough, and inline code inside bold', () => {
    deepStrictEqual(parseProse('*a* ~~b~~ **c `d` e**', true), [
      paragraph(
        { kind: 'em', content: [text('a')] },
        text(' '),
        { kind: 'del', content: [text('b')] },
        text(' '),
        { kind: 'strong', content: [text('c '), { kind: 'code', text: 'd' }, text(' e')] },
      ),
    ]);
  });

  it('keeps snake_case and escaped marks as text', () => {
    deepStrictEqual(parseProse('snake_case_name and \\*lit\\*', true), [
      paragraph(text('snake_case_name and *lit*')),
    ]);
  });

  it('breaks lines inside a paragraph and splits blocks on blank lines', () => {
    deepStrictEqual(parseProse('a\nb\n\nc', true), [
      paragraph(text('a'), { kind: 'break' }, text('b')),
      paragraph(text('c')),
    ]);
  });

  it('parses headings of every level', () => {
    deepStrictEqual(
      parseProse('# a\n## b\n### c\n#### d\n##### e\n###### f', true),
      ['a', 'b', 'c', 'd', 'e', 'f'].map((value, index) => ({
        kind: 'heading',
        level: index + 1,
        content: [text(value)],
      })),
    );
  });

  it('parses a dash line as a rule, not a list', () => {
    deepStrictEqual(parseProse('a\n\n---\n\n* * *', true), [
      paragraph(text('a')),
      { kind: 'rule' },
      { kind: 'rule' },
    ]);
  });

  it('parses a nested bullet list', () => {
    deepStrictEqual(parseProse('- a\n  - b\n  - c\n- d', true), [
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          {
            content: [text('a')],
            checked: null,
            children: [
              {
                kind: 'list',
                ordered: false,
                start: 1,
                items: [
                  { content: [text('b')], checked: null, children: [] },
                  { content: [text('c')], checked: null, children: [] },
                ],
              },
            ],
          },
          { content: [text('d')], checked: null, children: [] },
        ],
      },
    ]);
  });

  it('parses an ordered list from its first number, across blank lines', () => {
    deepStrictEqual(parseProse('3. a\n\n4. b', true), [
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [
          { content: [text('a')], checked: null, children: [] },
          { content: [text('b')], checked: null, children: [] },
        ],
      },
    ]);
  });

  it('parses task items', () => {
    deepStrictEqual(parseProse('- [ ] a\n- [x] b', true), [
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          { content: [text('a')], checked: false, children: [] },
          { content: [text('b')], checked: true, children: [] },
        ],
      },
    ]);
  });

  it('parses a paragraph followed directly by a table', () => {
    deepStrictEqual(parseProse('Results:\n| a | b |\n|---|---|', true), [
      paragraph(text('Results:')),
      { kind: 'table', head: [[text('a')], [text('b')]], align: ['start', 'start'], rows: [] },
    ]);
  });

  it('aligns table columns by their separator colons', () => {
    deepStrictEqual(parseProse('| a | b | c |\n| --- | :-: | -: |', true), [
      {
        kind: 'table',
        head: [[text('a')], [text('b')], [text('c')]],
        align: ['start', 'center', 'end'],
        rows: [],
      },
    ]);
  });

  it('keeps an escaped pipe and a pipe inside code in their cells', () => {
    deepStrictEqual(parseProse('| a |\n|-|\n| x \\| y |\n| `p | q` |', true), [
      {
        kind: 'table',
        head: [[text('a')]],
        align: ['start'],
        rows: [[[text('x | y')]], [[{ kind: 'code', text: 'p | q' }]]],
      },
    ]);
  });

  it('turns links off inside quotes and table cells too', () => {
    deepStrictEqual(parseProse('> [a](https://e.test)\n\n| [b](https://e.test) |\n|-|', false), [
      { kind: 'quote', blocks: [paragraph(text('a'))] },
      { kind: 'table', head: [[text('b')]], align: ['start'], rows: [] },
    ]);
  });

  it('parses a quote holding a list', () => {
    deepStrictEqual(parseProse('> - a\n> - b', true), [
      {
        kind: 'quote',
        blocks: [
          {
            kind: 'list',
            ordered: false,
            start: 1,
            items: [
              { content: [text('a')], checked: null, children: [] },
              { content: [text('b')], checked: null, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('nests quotes 100 deep and reads deeper markers as text', () => {
    let blocks = parseProse(`${'>'.repeat(20_000)} a`, true);
    for (let depth = 0; depth < 100; depth++) {
      const [quote] = blocks;
      if (quote?.kind !== 'quote') throw new Error(`no quote at depth ${depth}`);
      blocks = quote.blocks;
    }
    deepStrictEqual(blocks, [paragraph(text(`${'>'.repeat(19_900)} a`))]);
  });

  it('ends a quote at a line without a marker', () => {
    deepStrictEqual(parseProse('> a\nb', true), [
      { kind: 'quote', blocks: [paragraph(text('a'))] },
      paragraph(text('b')),
    ]);
  });

  it('keeps a code fence verbatim, links included, and drops its info string', () => {
    deepStrictEqual(parseProse('a\n```c++\n**[x](https://e.test)**\n```\nb', true), [
      paragraph(text('a')),
      { kind: 'code', text: '**[x](https://e.test)**' },
      paragraph(text('b')),
    ]);
  });

  it('closes a code fence only at a bare backtick run at least as long as its opener', () => {
    deepStrictEqual(parseProse('a\n\n````\n# b\n*c*\n````', true), [
      paragraph(text('a')),
      { kind: 'code', text: '# b\n*c*' },
    ]);
    deepStrictEqual(parseProse('````md\n```js\nx\n```\n````', true), [
      { kind: 'code', text: '```js\nx\n```' },
    ]);
    deepStrictEqual(parseProse('```\nx\n`````\ny', true), [
      { kind: 'code', text: 'x' },
      paragraph(text('y')),
    ]);
  });

  it('runs an unterminated fence to the end of the text', () => {
    deepStrictEqual(parseProse('a\n```ts\nconst b = 1;\n\nc', true), [
      paragraph(text('a')),
      { kind: 'code', text: 'const b = 1;\n\nc' },
    ]);
  });

  it('drops the head of a table whose header cells are all empty', () => {
    deepStrictEqual(parseProse('|||\n|-|-|\n| a | b |', true), [
      {
        kind: 'table',
        head: null,
        align: ['start', 'start'],
        rows: [[[text('a')], [text('b')]]],
      },
    ]);
  });

  it('closes a code span only at a backtick run of its own length', () => {
    deepStrictEqual(parseProse('a ``b`c`` d', true), [
      paragraph(text('a '), { kind: 'code', text: 'b`c' }, text(' d')),
    ]);
    deepStrictEqual(parseProse('``a` b', true), [paragraph(text('``a` b'))]);
  });

  it('drops one padding space per side of a code span, never from a blank one', () => {
    deepStrictEqual(parseProse('`` `x ``', true), [paragraph({ kind: 'code', text: '`x' })]);
    deepStrictEqual(parseProse('a ` ` b', true), [
      paragraph(text('a '), { kind: 'code', text: ' ' }, text(' b')),
    ]);
  });

  it('keeps a code span across a line separator', () => {
    deepStrictEqual(parseProse('`a\u2028b`', true), [
      paragraph({ kind: 'code', text: 'a\u2028b' }),
    ]);
  });

  it('closes no emphasis or link inside a code span', () => {
    deepStrictEqual(parseProse('Pattern *.txt in `a*b`', true), [
      paragraph(text('Pattern *.txt in '), { kind: 'code', text: 'a*b' }),
    ]);
    deepStrictEqual(parseProse('**`a** b`**', true), [
      paragraph({ kind: 'strong', content: [{ kind: 'code', text: 'a** b' }] }),
    ]);
    deepStrictEqual(parseProse('[`a]b`](/x)', true), [
      paragraph({
        kind: 'link',
        href: '/x',
        local: true,
        content: [{ kind: 'code', text: 'a]b' }],
      }),
    ]);
  });

  it('makes an escaped backtick literal and lets the rest of its run open a span', () => {
    deepStrictEqual(parseProse('x \\``a` y', true), [
      paragraph(text('x `'), { kind: 'code', text: 'a' }, text(' y')),
    ]);
    deepStrictEqual(parseProse('| a |\n|-|\n| \\``b` |', true), [
      {
        kind: 'table',
        head: [[text('a')]],
        align: ['start'],
        rows: [[[text('`'), { kind: 'code', text: 'b' }]]],
      },
    ]);
  });

  it('keeps a backslash inside a code span literal', () => {
    deepStrictEqual(parseProse('`a\\` b', true), [
      paragraph({ kind: 'code', text: 'a\\' }, text(' b')),
    ]);
  });

  it('reads a line opening with a code span that holds backticks as a paragraph, not a fence', () => {
    deepStrictEqual(parseProse('```a`b``c``` is required', true), [
      paragraph({ kind: 'code', text: 'a`b``c' }, text(' is required')),
    ]);
  });

  it('keeps a pipe inside a code span of any fence length in its cell', () => {
    deepStrictEqual(parseProse('| a | b |\n|-|-|\n| ``x|`y`` | `` ` |', true), [
      {
        kind: 'table',
        head: [[text('a')], [text('b')]],
        align: ['start', 'start'],
        rows: [[[{ kind: 'code', text: 'x|`y' }], [text('`` `')]]],
      },
    ]);
  });

  it('reads any formatted backticked value back as exactly one code span', () => {
    for (const template of [
      'Unknown block `{v}`',
      '`{v}` is required',
      '**Bad** `{v}` and *more*',
      'Pattern *.txt in `{v}`',
      '**`{v}`**',
      '| `{v}` | b |\n|-|-|',
    ]) {
      for (const v of [
        'my`file.pdf',
        '`',
        '``',
        '`x',
        'x`',
        'a`b``c',
        ' a ',
        '',
        'a\nb',
        'a\u2028b',
        '*_[]()|',
        'a** b',
        '[l](/x)',
        '# h',
        '\\',
        'x'.repeat(5000),
      ]) {
        const codes = codeRuns(parseProse(formatMessage(template, { v }, 'en'), true));
        deepStrictEqual(codes, [v === '' ? ' ' : escapeControls(v)], `${template} ${v}`);
      }
    }
  });

  it('reads pipe lines without a separator row as a paragraph', () => {
    deepStrictEqual(parseProse('| a |\n| b |', true), [
      paragraph(text('| a |'), { kind: 'break' }, text('| b |')),
    ]);
  });

  it('stays linear on inline markers that never close', () => {
    const started = performance.now();
    for (const unit of ['[``', '[`', ' _`', '[', '[x](', ' __a', '**a', '~~a', '![', '\\`']) {
      parseProse(unit.repeat(50_000), true);
    }
    ok(performance.now() - started < 1000);
  });
});
