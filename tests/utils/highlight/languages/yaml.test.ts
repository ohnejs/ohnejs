import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeYAML } from '../../../../src/utils/highlight/languages/yaml.ts';

const spans = (code: string) => tokenizeYAML(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeYAML', () => {
  it('classifies plain and quoted keys as properties', () => {
    deepStrictEqual(spans(`name: a\n"double": b\n'single' : c\nmy key:\n<<: d`), [
      ['property', 'name'],
      ['property', '"double"'],
      ['property', "'single'"],
      ['property', 'my key'],
      ['property', '<<'],
    ]);
  });

  it('classifies quoted strings with their escapes', () => {
    deepStrictEqual(spans(`a: "x\\"y"\nb: 'it''s'`), [
      ['property', 'a'],
      ['string', '"x\\"y"'],
      ['property', 'b'],
      ['string', "'it''s'"],
    ]);
  });

  it('continues a quoted string over indented and blank lines', () => {
    deepStrictEqual(spans(`a: "one\\\n  two\n\n  three"\nb: 'x\n  it''s: y'\nc: 1`), [
      ['property', 'a'],
      ['string', '"one\\\n  two\n\n  three"'],
      ['property', 'b'],
      ['string', "'x\n  it''s: y'"],
      ['property', 'c'],
      ['number', '1'],
    ]);
  });

  it('ends an unterminated quoted string at the next unindented line', () => {
    deepStrictEqual(spans(`a: "open\nb: 'open\nc: 1`), [
      ['property', 'a'],
      ['string', '"open'],
      ['property', 'b'],
      ['string', "'open"],
      ['property', 'c'],
      ['number', '1'],
    ]);
  });

  it('classifies numbers in every notation', () => {
    deepStrictEqual(
      spans('- 1\n- -2.5\n- 1e3\n- 1_000\n- 0x1F\n- 0o17\n- .5\n- .inf\n- -.Inf\n- .NaN'),
      ['1', '-2.5', '1e3', '1_000', '0x1F', '0o17', '.5', '.inf', '-.Inf', '.NaN'].map((n) => [
        'number',
        n,
      ]),
    );
  });

  it('leaves number-like plain scalars plain', () => {
    deepStrictEqual(spans('- 1.2.3\n- 2001-12-14\n- 12:30\n- 1 apple'), []);
  });

  it('classifies booleans and nulls as keywords', () => {
    deepStrictEqual(spans('[true, False, NULL, ~, yes, No, on, OFF, truthy]'), [
      ['keyword', 'true'],
      ['keyword', 'False'],
      ['keyword', 'NULL'],
      ['keyword', '~'],
      ['keyword', 'yes'],
      ['keyword', 'No'],
      ['keyword', 'on'],
      ['keyword', 'OFF'],
    ]);
  });

  it('reads a keyword or number before `:` as a key', () => {
    deepStrictEqual(spans('on: push\n404: missing'), [
      ['property', 'on'],
      ['property', '404'],
    ]);
  });

  it('classifies anchors and aliases as variables', () => {
    deepStrictEqual(spans('base: &base\n  a: 1\ncopy: *base'), [
      ['property', 'base'],
      ['variable', '&base'],
      ['property', 'a'],
      ['number', '1'],
      ['property', 'copy'],
      ['variable', '*base'],
    ]);
  });

  it('classifies tags as types', () => {
    deepStrictEqual(spans('a: !!str 1\nb: !Custom x\nc: ! y'), [
      ['property', 'a'],
      ['type', '!!str'],
      ['number', '1'],
      ['property', 'b'],
      ['type', '!Custom'],
      ['property', 'c'],
      ['type', '!'],
    ]);
  });

  it('classifies comments only after whitespace', () => {
    deepStrictEqual(spans('# top\na#b: c#d # end'), [
      ['comment', '# top'],
      ['property', 'a#b'],
      ['comment', '# end'],
    ]);
  });

  it('classifies document markers and directives as keywords', () => {
    deepStrictEqual(spans('%YAML 1.2\n---\na: 1\n...\n---x'), [
      ['keyword', '%YAML'],
      ['number', '1.2'],
      ['keyword', '---'],
      ['property', 'a'],
      ['number', '1'],
      ['keyword', '...'],
    ]);
  });

  it('leaves list dashes plain', () => {
    deepStrictEqual(spans('- a\n- - 1\n-b'), [['number', '1']]);
  });

  it('classifies keys and values inside flow collections', () => {
    deepStrictEqual(spans('{a: 1, "b": [x, null], c: {d: true}}'), [
      ['property', 'a'],
      ['number', '1'],
      ['property', '"b"'],
      ['keyword', 'null'],
      ['property', 'c'],
      ['property', 'd'],
      ['keyword', 'true'],
    ]);
  });

  it('keeps a colon without a following space inside a plain scalar', () => {
    deepStrictEqual(spans('url: http://x.com:80/a'), [['property', 'url']]);
  });

  it('classifies a block scalar body as one string', () => {
    const code = 'run: |\n  echo a\n    # not a comment\n\n  echo b\nnext: 1';
    deepStrictEqual(spans(code), [
      ['property', 'run'],
      ['keyword', '|'],
      ['string', 'echo a\n    # not a comment\n\n  echo b'],
      ['property', 'next'],
      ['number', '1'],
    ]);
  });

  it('reads every block scalar header', () => {
    deepStrictEqual(spans('- >-\n  a\n- !!str |2 # c\n   b\n--- |+\n x'), [
      ['keyword', '>-'],
      ['string', 'a'],
      ['type', '!!str'],
      ['keyword', '|2'],
      ['comment', '# c'],
      ['string', 'b'],
      ['keyword', '---'],
      ['keyword', '|+'],
      ['string', 'x'],
    ]);
  });

  it('ends a block scalar at the first line indented less than its body', () => {
    deepStrictEqual(spans('- key: |\n      a\n    other: 1'), [
      ['property', 'key'],
      ['keyword', '|'],
      ['string', 'a'],
      ['property', 'other'],
      ['number', '1'],
    ]);
  });

  it('opens no body for an empty block scalar', () => {
    deepStrictEqual(spans('  a: |\n  b: 1\nc: >'), [
      ['property', 'a'],
      ['keyword', '|'],
      ['property', 'b'],
      ['number', '1'],
      ['property', 'c'],
      ['keyword', '>'],
    ]);
  });

  it('runs an unterminated block scalar to the end', () => {
    deepStrictEqual(spans('a: >\n  one\n  two\n'), [
      ['property', 'a'],
      ['keyword', '>'],
      ['string', 'one\n  two'],
    ]);
  });

  it('reads a `|` inside a plain scalar as text', () => {
    deepStrictEqual(spans('a: b |\n  c'), [['property', 'a']]);
  });

  it('emits sorted, non-empty, in-bounds tokens and scans to the end', () => {
    const code = 'ä: "ü" # x\n- &a !t |\n  b\n? [c, {d: e}]\n: *a\n@ ` % | > , ] true';
    let last = 0;
    for (const token of tokenizeYAML(code)) {
      ok(token.start >= last && token.end > token.start && token.end <= code.length);
      last = token.end;
    }
    deepStrictEqual(last, code.length);
  });

  it('stays linear on adversarial input', () => {
    const inputs = [
      '"'.repeat(1 << 20),
      '"\n '.repeat(1 << 18),
      "'\n\n ".repeat(1 << 18),
      '"\\\n'.repeat(1 << 18),
      "'a".repeat(1 << 19),
      '#'.repeat(1 << 20),
      '- '.repeat(1 << 19),
      ' |'.repeat(1 << 19) + '\n x',
      ': |\n'.repeat(1 << 18),
      'a: '.repeat(1 << 18) + ' | # | #'.repeat(1 << 16) + '\n x',
      'a: |\n' + '\n'.repeat(1 << 20),
      'a: |\n' + '  x\n'.repeat(1 << 18),
      'a' + ' '.repeat(1 << 20) + '#',
      '[{'.repeat(1 << 19),
      '&!'.repeat(1 << 19),
      '\n '.repeat(1 << 19),
    ];
    for (const input of inputs) {
      const start = performance.now();
      tokenizeYAML(input);
      ok(performance.now() - start < 1000, input.slice(0, 8));
    }
  });
});
