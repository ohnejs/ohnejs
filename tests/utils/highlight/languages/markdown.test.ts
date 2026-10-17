import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeMarkdown } from '../../../../src/utils/highlight/languages/markdown.ts';

const spans = (code: string) =>
  tokenizeMarkdown(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeMarkdown', () => {
  it('classifies ATX headings by their whole line', () => {
    deepStrictEqual(spans('# Title\n  ### Deep `x` ###\n#tag\n####### seven'), [
      ['keyword', '# Title'],
      ['keyword', '### Deep `x` ###'],
    ]);
  });

  it('classifies a setext heading and its underline', () => {
    deepStrictEqual(spans('Title\n=====\n\nSub\n---'), [
      ['keyword', 'Title'],
      ['keyword', '====='],
      ['keyword', 'Sub'],
      ['keyword', '---'],
    ]);
  });

  it('keeps a list item above a rule out of the heading', () => {
    deepStrictEqual(spans('- item\n---'), [
      ['keyword', '-'],
      ['keyword', '---'],
    ]);
  });

  it('leaves a standalone `=` line plain', () => {
    deepStrictEqual(spans('\n==='), []);
  });

  it('classifies thematic breaks', () => {
    deepStrictEqual(spans('***\n- - -\n___\n* * *'), [
      ['keyword', '***'],
      ['keyword', '- - -'],
      ['keyword', '___'],
      ['keyword', '* * *'],
    ]);
  });

  it('classifies list markers, nested and ordered', () => {
    deepStrictEqual(spans('- a\n  * b\n    + c\n1. d\n2) e'), [
      ['keyword', '-'],
      ['keyword', '*'],
      ['keyword', '+'],
      ['keyword', '1.'],
      ['keyword', '2)'],
    ]);
  });

  it('classifies task boxes after a list marker', () => {
    deepStrictEqual(spans('- [ ] todo\n- [x] done\n[ ] loose'), [
      ['keyword', '-'],
      ['keyword', '[ ]'],
      ['keyword', '-'],
      ['keyword', '[x]'],
    ]);
  });

  it('leaves a marker without a space, or mid-line, plain', () => {
    deepStrictEqual(spans('-1 and +2\na - b 1. c'), []);
  });

  it('classifies blockquotes, nested, with a list inside', () => {
    deepStrictEqual(spans('> a\n> > b\n> - c'), [
      ['keyword', '>'],
      ['keyword', '> >'],
      ['keyword', '>'],
      ['keyword', '-'],
    ]);
  });

  it('reads four spaces of indent as no heading or quote', () => {
    deepStrictEqual(spans('p\n    # code\n    > code'), []);
  });

  it('classifies an indented code block as one string', () => {
    deepStrictEqual(spans('    # a\nPara\n\n    a*b*c\n\n\t[x](y)\n  \nafter *em*'), [
      ['string', '# a'],
      ['string', 'a*b*c\n\n\t[x](y)'],
      ['variable', '*em*'],
    ]);
  });

  it('keeps a lazy line and a list continuation out of indented code', () => {
    deepStrictEqual(spans('p\n    *a*\n\n- item\n\n    *b*\n\n  - deep\n\n      *c*'), [
      ['variable', '*a*'],
      ['keyword', '-'],
      ['variable', '*b*'],
      ['keyword', '-'],
      ['variable', '*c*'],
    ]);
  });

  it('classifies code spans by their backtick run', () => {
    deepStrictEqual(spans('`a` and ``b`c`` and ```d``` x'), [
      ['string', '`a`'],
      ['string', '``b`c``'],
      ['string', '```d```'],
    ]);
  });

  it('closes a code span only on a run of its own length', () => {
    deepStrictEqual(spans('`a``b` ``c`'), [['string', '`a``b`']]);
  });

  it('ends an unterminated code span at its line', () => {
    deepStrictEqual(spans('`open\n`shut`'), [['string', '`shut`']]);
  });

  it('classifies a fenced block as one string, info string included', () => {
    deepStrictEqual(spans('```ts\nconst a = `x`\n```\nafter *em*'), [
      ['string', '```ts\nconst a = `x`\n```'],
      ['variable', '*em*'],
    ]);
  });

  it('classifies a tilde fence', () => {
    deepStrictEqual(spans('~~~ sh\n# not a heading\n~~~~\n# heading'), [
      ['string', '~~~ sh\n# not a heading\n~~~~'],
      ['keyword', '# heading'],
    ]);
  });

  it('closes a fence only on a run at least as long as its opener', () => {
    const code = '````md\n```js\nx\n```\n````';
    deepStrictEqual(spans(code), [['string', code]]);
  });

  it('never closes a fence on the other fence character', () => {
    deepStrictEqual(spans('```\na\n~~~\nb'), [['string', '```\na\n~~~\nb']]);
  });

  it('runs an unterminated fence to the end', () => {
    deepStrictEqual(spans('text\n```\n# a\n'), [['string', '```\n# a\n']]);
  });

  it('reads an indented fence inside a list item', () => {
    deepStrictEqual(spans('- a\n  ```\n  x\n  ```'), [
      ['keyword', '-'],
      ['string', '```\n  x\n  ```'],
    ]);
  });

  it('reads backticks in an info string as a code span, not a fence', () => {
    deepStrictEqual(spans('```a```'), [['string', '```a```']]);
  });

  it('classifies links: text as a function, destination as a string', () => {
    deepStrictEqual(spans('See [the docs](https://ohne.dev "Docs") now.'), [
      ['function', '[the docs]'],
      ['string', '(https://ohne.dev "Docs")'],
    ]);
  });

  it('classifies images, reference links and an angle destination', () => {
    deepStrictEqual(spans('![logo](a.png) [text][ref] [x](<a b.md>)'), [
      ['function', '![logo]'],
      ['string', '(a.png)'],
      ['function', '[text]'],
      ['string', '[ref]'],
      ['function', '[x]'],
      ['string', '(<a b.md>)'],
    ]);
  });

  it('classifies an image inside a link', () => {
    deepStrictEqual(spans('[![badge](b.svg)](https://ci)'), [
      ['function', '![badge]'],
      ['string', '(b.svg)'],
      ['string', '(https://ci)'],
    ]);
  });

  it('classifies a link reference definition', () => {
    deepStrictEqual(spans('[ref]: https://ohne.dev "Title"'), [
      ['function', '[ref]'],
      ['string', 'https://ohne.dev'],
    ]);
  });

  it('reads a footnote definition as text, never a link target', () => {
    deepStrictEqual(spans('[^1]: The *note*'), [
      ['function', '[^1]'],
      ['variable', '*note*'],
    ]);
  });

  it('leaves brackets that link nowhere plain', () => {
    deepStrictEqual(spans('[a] and [b] (c)'), []);
  });

  it('classifies autolinks and bare URLs', () => {
    deepStrictEqual(spans('<https://a.dev/x> <me@a.dev> at https://b.dev/p?q=1.'), [
      ['string', '<https://a.dev/x>'],
      ['string', '<me@a.dev>'],
      ['string', 'https://b.dev/p?q=1'],
    ]);
  });

  it('keeps closing punctuation out of a bare URL', () => {
    deepStrictEqual(spans('(see https://a.dev/x).'), [['string', 'https://a.dev/x']]);
  });

  it('classifies emphasis, strong and strikethrough', () => {
    deepStrictEqual(spans('*a* _b_ **c d** __e__ ~~f~~ x*y*z'), [
      ['variable', '*a*'],
      ['variable', '_b_'],
      ['variable', '**c d**'],
      ['variable', '__e__'],
      ['variable', '~~f~~'],
      ['variable', '*y*'],
    ]);
  });

  it('classifies strong emphasis with a triple marker', () => {
    deepStrictEqual(spans('***a b*** ___c___ snake___case___x'), [
      ['variable', '***a b***'],
      ['variable', '___c___'],
    ]);
  });

  it('leaves intraword underscores and spaced markers plain', () => {
    deepStrictEqual(spans('snake_case_name foo__bar__ a * b * c ** d **'), []);
  });

  it('never runs emphasis across a line', () => {
    deepStrictEqual(spans('*open\nclose*'), []);
  });

  it('leaves escaped markers plain', () => {
    deepStrictEqual(spans('\\*not em\\* \\# \\`no code\\`'), []);
  });

  it('classifies HTML comments and runs an unterminated one to the end', () => {
    deepStrictEqual(spans('a <!-- note --> b\n<!-- open\n# x'), [
      ['comment', '<!-- note -->'],
      ['comment', '<!-- open\n# x'],
    ]);
  });

  it('tokenizes an inline HTML tag as HTML', () => {
    deepStrictEqual(spans(`<div align="center">\n<br/> a <b and c <a b='>' c=d>x</a>`), [
      ['tag', '<div'],
      ['attribute', 'align'],
      ['string', '"center"'],
      ['tag', '>'],
      ['tag', '<br'],
      ['tag', '/>'],
      ['tag', '<a'],
      ['attribute', 'b'],
      ['string', "'>'"],
      ['attribute', 'c'],
      ['string', 'd'],
      ['tag', '>'],
      ['tag', '</a'],
      ['tag', '>'],
    ]);
  });

  it('classifies front matter at the very start as a comment', () => {
    deepStrictEqual(spans('---\ntitle: Hi\n---\n# Hi'), [
      ['comment', '---\ntitle: Hi\n---'],
      ['keyword', '# Hi'],
    ]);
  });

  it('reads empty front matter', () => {
    deepStrictEqual(spans('---\n---\nx'), [['comment', '---\n---']]);
  });

  it('reads an unclosed front matter opener as a rule', () => {
    deepStrictEqual(spans('---\ntitle: Hi'), [['keyword', '---']]);
  });

  it('reads `---` later in the document as a rule, never front matter', () => {
    deepStrictEqual(spans('\n---\na\n---'), [
      ['keyword', '---'],
      ['keyword', 'a'],
      ['keyword', '---'],
    ]);
  });

  it('emits sorted, non-empty, in-bounds tokens for a whole document', () => {
    const code = [
      '---',
      'title: Guide',
      '---',
      '# Guide',
      '',
      'Read [this](https://a.dev) **first**, then run `pnpm i`.',
      '',
      '> [!NOTE]',
      '> - [x] _done_',
      '',
      '```sh',
      'pnpm dev',
      '```',
      '',
      '<!-- end -->',
      '1. <kbd>Ctrl</kbd>',
      '[ref]: <https://b.dev>',
    ].join('\n');
    let end = 0;
    for (const token of tokenizeMarkdown(code)) {
      ok(token.start >= end && token.end > token.start && token.end <= code.length);
      end = token.end;
    }
  });

  it('stays linear on adversarial input', () => {
    const units = [
      '\n\n    a',
      '\n\n    ',
      '- a\n\n    b',
      '\n    \n',
      '\t\n',
      '<a "',
      `<a "'`,
      '<a x="<a" ',
      '<a',
      '***a ',
      '___a ',
      '[^a]: ',
      '`',
      '*a',
      '_a',
      '[a](',
      '```\n',
      '# ',
      '> ',
      '- ',
      '<!--',
    ];
    for (const unit of units) {
      const code = unit.repeat(Math.ceil(1_000_000 / unit.length));
      const started = performance.now();
      tokenizeMarkdown(code);
      ok(performance.now() - started < 1000, unit);
    }
  });
});
