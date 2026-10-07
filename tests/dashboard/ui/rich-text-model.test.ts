import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  NodeLike,
  RichText,
  RichTextListItem,
  RichTextRun,
} from '../../../src/utils/index.ts';

import {
  clampPos,
  comparePos,
  denormalizePath,
  diffText,
  domText,
  formatPath,
  leafAt,
  leafPoint,
  leaves,
  linkRangeAt,
  marksAt,
  parsePath,
  pointOffset,
  selectionRange,
} from '../../../src/dashboard/ui/rich-text-model.ts';
import { comment, el, text } from '../../utils/html/_node-like.ts';

/**
 * The child of `node` at each index in turn.
 */
function child(node: NodeLike, ...indexes: number[]): NodeLike {
  return indexes.reduce((parent, index) => [...parent.childNodes][index]!, node);
}

const DOC: RichText = [
  { kind: 'heading', level: 2, content: [{ text: 'Title' }] },
  {
    kind: 'list',
    ordered: false,
    items: [
      {
        content: [{ text: 'a' }],
        list: { kind: 'list', ordered: true, items: [{ content: [{ text: 'b' }] }] },
      },
      { content: [{ text: 'c' }] },
    ],
  },
  { kind: 'paragraph', content: [] },
];

/**
 * Renders runs as the editor does: marks inside a link, `\n` as `<br>`, an extra `<br>` after a final `\n`.
 */
function render(runs: RichTextRun[]): NodeLike[] {
  const nodes = runs.flatMap((run) => {
    const lines = run.text.split('\n');
    let inner = lines.flatMap((line, index) => [
      ...(index > 0 ? [el('br', {})] : []),
      ...(line === '' ? [] : [text(line)]),
    ]);
    for (const mark of [...(run.marks ?? [])].reverse()) inner = [el(mark, {}, ...inner)];
    return run.link ? [el('a', { href: '/x' }, ...inner)] : inner;
  });
  const content = runs.map((run) => run.text).join('');
  if (content === '' || content.endsWith('\n')) nodes.push(el('br', {}));
  return nodes;
}

const SHAPES: Record<string, RichTextRun[]> = {
  empty: [],
  plain: [{ text: 'hello' }],
  'trailing line break': [{ text: 'a\n' }],
  'line breaks only': [{ text: '\n\n' }],
  'leading line break': [{ text: '\na' }],
  marks: [{ text: 'a', marks: ['strong'] }, { text: 'b\nc', marks: ['em', 'code'] }, { text: 'd' }],
  link: [{ text: 'go ' }, { text: 'here', link: { url: '/here' }, marks: ['em'] }, { text: '\n' }],
};

describe('leaves', () => {
  it('lists each leaf with its path in document order, items before their sublists', () => {
    deepStrictEqual(
      leaves(DOC).map((entry) => entry.path),
      [[0], [1, 0], [1, 0, 0], [1, 1], [2]],
    );
  });

  it('finds a leaf by path, and nothing at a list or past the end', () => {
    deepStrictEqual(leafAt(DOC, [1, 0, 0])?.content, [{ text: 'b' }]);
    strictEqual(leafAt(DOC, [1]), undefined);
    strictEqual(leafAt(DOC, [1, 2]), undefined);
    strictEqual(leafAt(DOC, [0, 0]), undefined);
    strictEqual(leafAt(DOC, [3]), undefined);
  });
});

describe('comparePos', () => {
  it('orders an item before its sublist and offsets within a leaf', () => {
    ok(comparePos({ path: [1, 0], offset: 1 }, { path: [1, 0, 0], offset: 0 }) < 0);
    ok(comparePos({ path: [1, 1], offset: 0 }, { path: [1, 0, 0], offset: 1 }) > 0);
    ok(comparePos({ path: [0], offset: 2 }, { path: [0], offset: 1 }) > 0);
    strictEqual(comparePos({ path: [2], offset: 0 }, { path: [2], offset: 0 }), 0);
  });

  it('puts a backward selection in document order', () => {
    const anchor = { path: [2], offset: 0 };
    const head = { path: [0], offset: 1 };
    deepStrictEqual(selectionRange({ anchor, head }), { from: head, to: anchor });
  });
});

describe('marksAt', () => {
  const doc: RichText = [
    { kind: 'paragraph', content: [{ text: 'ab', marks: ['strong'] }, { text: 'cd' }] },
  ];

  it('takes the marks of the character before the position', () => {
    deepStrictEqual(marksAt(doc, { path: [0], offset: 2 }), ['strong']);
    deepStrictEqual(marksAt(doc, { path: [0], offset: 3 }), []);
  });

  it('takes the marks of the first character at a leaf start', () => {
    deepStrictEqual(marksAt(doc, { path: [0], offset: 0 }), ['strong']);
  });

  it('has no marks in an empty leaf', () => {
    deepStrictEqual(marksAt([{ kind: 'paragraph', content: [] }], { path: [0], offset: 0 }), []);
  });
});

describe('linkRangeAt', () => {
  const link = { url: '/a' };
  const doc: RichText = [
    {
      kind: 'paragraph',
      content: [
        { text: 'x' },
        { text: 'ab', link },
        { text: 'cd', link, marks: ['strong'] },
        { text: 'e', link: { url: '/b' } },
      ],
    },
  ];

  it('spans every neighbouring run with an equal link', () => {
    deepStrictEqual(linkRangeAt(doc, { path: [0], offset: 3 }), { from: 1, to: 5, link });
  });

  it('prefers the link before the position, then the one after', () => {
    deepStrictEqual(linkRangeAt(doc, { path: [0], offset: 5 }), { from: 1, to: 5, link });
    deepStrictEqual(linkRangeAt(doc, { path: [0], offset: 1 }), { from: 1, to: 5, link });
  });

  it('finds no link where neither neighbour has one', () => {
    strictEqual(linkRangeAt(doc, { path: [0], offset: 0 }), undefined);
    strictEqual(
      linkRangeAt([{ kind: 'paragraph', content: [{ text: 'ab' }] }], { path: [0], offset: 1 }),
      undefined,
    );
  });
});

describe('clampPos', () => {
  it('clamps an offset to its leaf', () => {
    deepStrictEqual(clampPos(DOC, { path: [0], offset: 9 }), { path: [0], offset: 5 });
    deepStrictEqual(clampPos(DOC, { path: [1, 1], offset: -1 }), { path: [1, 1], offset: 0 });
  });

  it('falls back to the end of the leaf before a path with no leaf', () => {
    deepStrictEqual(clampPos(DOC, { path: [1, 0, 3], offset: 0 }), { path: [1, 0, 0], offset: 1 });
    deepStrictEqual(clampPos(DOC, { path: [9], offset: 2 }), { path: [2], offset: 0 });
  });

  it('falls back to the first leaf before every leaf', () => {
    deepStrictEqual(clampPos(DOC.slice(1), { path: [0], offset: 4 }), { path: [0, 0], offset: 0 });
  });
});

describe('denormalizePath', () => {
  const li = (text: string, ...items: RichTextListItem[]): RichTextListItem =>
    items.length > 0
      ? { content: [{ text }], list: { kind: 'list', ordered: false, items } }
      : { content: [{ text }] };

  it('maps a path past the empty items normalizing drops', () => {
    const doc: RichText = [{ kind: 'list', ordered: false, items: [li('a'), li(''), li('b')] }];
    deepStrictEqual(denormalizePath(doc, [0, 1]), [0, 2]);
  });

  it('maps a path past empty lists and sublists, keeping an empty item with a sublist', () => {
    const doc: RichText = [
      { kind: 'list', ordered: false, items: [li('\n')] },
      { kind: 'paragraph', content: [] },
      { kind: 'list', ordered: true, items: [li('a', li('')), li('', li('')), li('', li('b'))] },
    ];
    deepStrictEqual(denormalizePath(doc, [0]), [1]);
    deepStrictEqual(denormalizePath(doc, [1, 1]), [2, 2]);
    deepStrictEqual(denormalizePath(doc, [1, 1, 0]), [2, 2, 0]);
  });

  it('keeps a line break item that becomes a space without line breaks', () => {
    const doc: RichText = [{ kind: 'list', ordered: false, items: [li('\n'), li('a')] }];
    deepStrictEqual(denormalizePath(doc, [0, 0]), [0, 1]);
    deepStrictEqual(denormalizePath(doc, [0, 0], { lineBreaks: false }), [0, 0]);
  });

  it('gives nothing for a path past the normalized value', () => {
    const doc: RichText = [{ kind: 'list', ordered: false, items: [li('a'), li('')] }];
    strictEqual(denormalizePath(doc, [0, 1]), undefined);
    strictEqual(denormalizePath(doc, [0, 0, 0]), undefined);
    strictEqual(denormalizePath(doc, [1]), undefined);
  });
});

describe('paths', () => {
  it('round-trips through `data-path`', () => {
    for (const path of [[0], [3, 1], [1, 0, 2, 4]])
      deepStrictEqual(parsePath(formatPath(path)), path);
  });

  it('reads anything else as no path', () => {
    for (const value of [null, '', '1.', '.1', 'a', '1..2', '-1'])
      strictEqual(parsePath(value), undefined);
  });
});

describe('DOM mapping', () => {
  for (const [name, runs] of Object.entries(SHAPES)) {
    it(`round-trips every offset of a leaf with ${name}`, () => {
      const model = runs.map((run) => run.text).join('');
      const leaf = el('p', { 'data-path': '0' }, ...render(runs));
      strictEqual(domText(leaf), model);
      for (let offset = 0; offset <= model.length; offset++) {
        const point = leafPoint(leaf, offset);
        strictEqual(pointOffset(leaf, point.node, point.offset), offset);
      }
      strictEqual(pointOffset(leaf, leaf, 0), 0);
      strictEqual(pointOffset(leaf, leaf, [...leaf.childNodes].length), model.length);
    });
  }

  it('maps a nested item through its wrapper, leaving the sublist out', () => {
    const wrapper = el('div', { 'data-path': '1.0.2' }, ...render(SHAPES.marks!));
    el('li', {}, wrapper, el('ul', {}, el('li', {}, el('div', {}, text('nested')))));
    deepStrictEqual(parsePath(wrapper.getAttribute!('data-path')), [1, 0, 2]);
    strictEqual(domText(wrapper), 'ab\ncd');
    deepStrictEqual(leafPoint(wrapper, 3), {
      node: child(wrapper, 1, 0, 2),
      offset: 0,
    });
  });

  it('puts the caret after a trailing line break before the extra `<br>`', () => {
    const leaf = el('p', {}, ...render([{ text: 'a\n' }]));
    deepStrictEqual(leafPoint(leaf, 2), { node: leaf, offset: 2 });
    deepStrictEqual(leafPoint(leaf, 1), { node: child(leaf, 0), offset: 1 });
  });

  it('puts the caret before the placeholder `<br>` of an empty leaf', () => {
    const leaf = el('p', {}, el('br', {}));
    deepStrictEqual(leafPoint(leaf, 0), { node: leaf, offset: 0 });
    strictEqual(domText(leaf), '');
  });

  it('counts points inside marks and links, and ignores empty text nodes and comments', () => {
    const bold = text('bc');
    const leaf = el(
      'p',
      {},
      text('a'),
      el('a', {}, el('strong', {}, bold)),
      text(''),
      comment('x'),
      text('d'),
    );
    strictEqual(pointOffset(leaf, bold, 1), 2);
    strictEqual(pointOffset(leaf, child(leaf, 1), 1), 3);
    strictEqual(domText(leaf), 'abcd');
  });

  it('reads unknown markup a browser left behind as its text', () => {
    const leaf = el('p', {}, el('span', {}, text('a'), el('br', {})), el('font', {}, text('b')));
    strictEqual(domText(leaf), 'a\nb');
  });
});

describe('diffText', () => {
  it('finds a single replacement between a common prefix and suffix', () => {
    deepStrictEqual(diffText('abc', 'aXc'), { from: 1, to: 2, text: 'X' });
    deepStrictEqual(diffText('abc', 'abXc'), { from: 2, to: 2, text: 'X' });
    deepStrictEqual(diffText('abc', 'ac'), { from: 1, to: 2, text: '' });
    deepStrictEqual(diffText('abc', 'abc'), { from: 0, to: 0, text: '' });
  });

  it('places a repeated letter where the caret says it was typed', () => {
    deepStrictEqual(diffText('aa', 'aaa', 1), { from: 0, to: 0, text: 'a' });
    deepStrictEqual(diffText('aa', 'aaa', 2), { from: 1, to: 1, text: 'a' });
    deepStrictEqual(diffText('aa', 'aaa', 3), { from: 2, to: 2, text: 'a' });
    deepStrictEqual(diffText('aaa', 'aa', 1), { from: 1, to: 2, text: '' });
  });

  it('never splits a surrogate pair', () => {
    deepStrictEqual(diffText('x😀y', 'x😁y'), { from: 1, to: 3, text: '😁' });
    deepStrictEqual(diffText('x😀', 'x🈀'), { from: 1, to: 3, text: '🈀' });
  });
});
