import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichTextState } from '../../../src/dashboard/ui/rich-text-commands.ts';
import type { Pos } from '../../../src/dashboard/ui/rich-text-model.ts';
import type {
  Link,
  RichText,
  RichTextBlock,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextOptions,
  RichTextRun,
} from '../../../src/utils/index.ts';

import {
  clearMarks,
  createRichTextState,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertSlice,
  insertText,
  liftItem,
  markdownShortcut,
  removeLink,
  replaceText,
  setBlockType,
  setLink,
  sinkItem,
  splitBlock,
  toggleList,
  toggleMark,
} from '../../../src/dashboard/ui/rich-text-commands.ts';
import { clampPos, leaves } from '../../../src/dashboard/ui/rich-text-model.ts';
import { checkRichText, conformRichText, normalizeRichText } from '../../../src/utils/index.ts';
import { PAGE, PERMISSIVE } from '../../utils/rich-text/fixtures.ts';

type Content = string | RichTextRun;

const LINK: Link = { url: '/a' };

function runs(content: Content[]): RichTextRun[] {
  return content.map((run) => (typeof run === 'string' ? { text: run } : run));
}

function p(...content: Content[]): RichTextBlock {
  return { kind: 'paragraph', content: runs(content) };
}

function h(level: 2 | 3 | 4 | 5 | 6, ...content: Content[]): RichTextBlock {
  return { kind: 'heading', level, content: runs(content) };
}

function quote(...content: Content[]): RichTextBlock {
  return { kind: 'quote', content: runs(content) };
}

function ul(...items: RichTextListItem[]): RichTextList {
  return { kind: 'list', ordered: false, items };
}

function ol(...items: RichTextListItem[]): RichTextList {
  return { kind: 'list', ordered: true, items };
}

function li(content: Content | Content[], list?: RichTextList): RichTextListItem {
  const item = { content: runs([content].flat()) };
  return list ? { ...item, list } : item;
}

function at(path: number[], offset: number): Pos {
  return { path, offset };
}

function state(doc: RichText, anchor: Pos, head = anchor): RichTextState {
  return { doc, selection: { anchor, head } };
}

function caretOf(result: RichTextState | undefined): Pos {
  ok(result);
  deepStrictEqual(result.selection.anchor, result.selection.head);
  return result.selection.head;
}

describe('createRichTextState', () => {
  it('opens an empty value on one empty paragraph', () => {
    deepStrictEqual(createRichTextState([]), state([p()], at([0], 0)));
  });

  it('puts the caret at the start of the first leaf', () => {
    const doc = [ul(li('a'))];
    deepStrictEqual(createRichTextState(doc), state(doc, at([0, 0], 0)));
  });
});

describe('insertText and replaceText', () => {
  const marked = [p({ text: 'ab', marks: ['strong'] }, 'cd')];

  it('takes the marks of the run before the caret', () => {
    const result = insertText(state(marked, at([0], 2)), 'x');
    deepStrictEqual(result.doc, [p({ text: 'abx', marks: ['strong'] }, 'cd')]);
    deepStrictEqual(caretOf(result), at([0], 3));
  });

  it('takes the marks of the first run at a leaf start', () => {
    const result = insertText(state(marked, at([0], 0)), 'x');
    deepStrictEqual(result.doc, [p({ text: 'xab', marks: ['strong'] }, 'cd')]);
  });

  it('gives stored marks priority, then clears them', () => {
    const stored = toggleMark(state(marked, at([0], 1)), 'em');
    deepStrictEqual(stored.storedMarks, ['strong', 'em']);
    const result = insertText(stored, 'x');
    deepStrictEqual(result.doc, [
      p(
        { text: 'a', marks: ['strong'] },
        { text: 'x', marks: ['strong', 'em'] },
        {
          text: 'b',
          marks: ['strong'],
        },
        'cd',
      ),
    ]);
    strictEqual(result.storedMarks, undefined);
  });

  it('never extends a link by typing after or before it', () => {
    const doc = [p({ text: 'go', link: LINK })];
    deepStrictEqual(insertText(state(doc, at([0], 2)), 'x').doc, [
      p({ text: 'go', link: LINK }, 'x'),
    ]);
    deepStrictEqual(insertText(state(doc, at([0], 0)), 'x').doc, [
      p('x', { text: 'go', link: LINK }),
    ]);
  });

  it('keeps the link for text typed inside it', () => {
    const doc = [p({ text: 'go', link: LINK })];
    deepStrictEqual(insertText(state(doc, at([0], 1)), 'x').doc, [p({ text: 'gxo', link: LINK })]);
  });

  it('keeps the link when the replaced text lies within it, and drops it when it leaves it', () => {
    const doc = [p('a', { text: 'go', link: LINK })];
    deepStrictEqual(insertText(state(doc, at([0], 1), at([0], 3)), 'X').doc, [
      p('a', { text: 'X', link: LINK }),
    ]);
    deepStrictEqual(insertText(state(doc, at([0], 0), at([0], 2)), 'X').doc, [
      p('X', { text: 'o', link: LINK }),
    ]);
  });

  it('joins the leaves a replacement spans', () => {
    const doc = [p('ab'), h(2, 'cd'), p('ef')];
    const result = replaceText(state(doc, at([0], 0)), at([2], 1), at([0], 1), 'X');
    deepStrictEqual(result.doc, [p('aXf')]);
    deepStrictEqual(caretOf(result), at([0], 2));
  });

  it('leaves the state alone for an empty edit', () => {
    const before = state(marked, at([0], 1));
    strictEqual(replaceText(before, at([0], 1), at([0], 1), ''), before);
  });
});

describe('deleteSelection', () => {
  it('deletes across list items, re-nesting the items left behind', () => {
    const doc = [p('ab'), ul(li('cd', ul(li('ef', ul(li('gh'))))), li('ij'))];
    const result = deleteSelection(state(doc, at([0], 1), at([1, 0, 0], 1)));
    deepStrictEqual(result.doc, [p('af'), ul(li('gh'), li('ij'))]);
    deepStrictEqual(caretOf(result), at([0], 1));
  });
});

describe('deleteBackward', () => {
  it('deletes the character before the caret, and a surrogate pair whole', () => {
    deepStrictEqual(deleteBackward(state([p('ab')], at([0], 2))).doc, [p('a')]);
    deepStrictEqual(deleteBackward(state([p('a😀')], at([0], 3))).doc, [p('a')]);
  });

  it('walks back through a list into a paragraph', () => {
    let result = state([p('x'), ul(li('a'), li('b'))], at([1, 1], 0));
    result = deleteBackward(result);
    deepStrictEqual(result.doc, [p('x'), ul(li('a')), p('b')]);
    deepStrictEqual(caretOf(result), at([2], 0));
    result = deleteBackward(result);
    deepStrictEqual(result.doc, [p('x'), ul(li('ab'))]);
    deepStrictEqual(caretOf(result), at([1, 0], 1));
    result = deleteBackward({
      ...result,
      selection: { anchor: at([1, 0], 0), head: at([1, 0], 0) },
    });
    deepStrictEqual(result.doc, [p('x'), p('ab')]);
    result = deleteBackward(result);
    deepStrictEqual(result.doc, [p('xab')]);
    deepStrictEqual(caretOf(result), at([0], 1));
  });

  it('lifts a nested item, keeping its text', () => {
    const result = deleteBackward(state([ul(li('a', ul(li('b'))))], at([0, 0, 0], 0)));
    deepStrictEqual(result.doc, [ul(li('a'), li('b'))]);
    deepStrictEqual(caretOf(result), at([0, 1], 0));
  });

  it('joins a leaf into the last and deepest item of the list before it', () => {
    const doc = [ul(li('a', ul(li('b', ul(li('c')))))), p('d')];
    const result = deleteBackward(state(doc, at([1], 0)));
    deepStrictEqual(result.doc, [ul(li('a', ul(li('b', ul(li('cd'))))))]);
    deepStrictEqual(caretOf(result), at([0, 0, 0, 0], 1));
  });

  it('turns a heading or quote in the first leaf into a paragraph, and leaves a paragraph', () => {
    deepStrictEqual(deleteBackward(state([h(3, 'a')], at([0], 0))).doc, [p('a')]);
    deepStrictEqual(deleteBackward(state([quote('a')], at([0], 0))).doc, [p('a')]);
    const first = state([p('a')], at([0], 0));
    strictEqual(deleteBackward(first), first);
  });

  it('removes an empty paragraph before the leaf instead of joining', () => {
    const heading = h(2, 'x');
    const result = deleteBackward(state([p(), heading], at([1], 0)));
    deepStrictEqual(result.doc, [heading]);
    strictEqual(result.doc[0], heading);
  });
});

describe('deleteForward', () => {
  it('deletes the character after the caret', () => {
    deepStrictEqual(deleteForward(state([p('😀b')], at([0], 0))).doc, [p('b')]);
  });

  it('joins the next leaf into this one', () => {
    const result = deleteForward(state([p('a'), h(2, 'b')], at([0], 1)));
    deepStrictEqual(result.doc, [p('ab')]);
    deepStrictEqual(caretOf(result), at([0], 1));
  });

  it('joins the first item of a following list, lifting its sublist', () => {
    const doc = [p('a'), ul(li('b', ul(li('c'))))];
    deepStrictEqual(deleteForward(state(doc, at([0], 1))).doc, [p('ab'), ul(li('c'))]);
  });

  it('lets an empty paragraph give way to the next leaf', () => {
    const heading = h(2, 'x');
    const result = deleteForward(state([p(), heading], at([0], 0)));
    deepStrictEqual(result.doc, [heading]);
    deepStrictEqual(caretOf(result), at([0], 0));
  });

  it('does nothing at the end of the last leaf', () => {
    const last = state([p('a')], at([0], 1));
    strictEqual(deleteForward(last), last);
  });
});

describe('splitBlock', () => {
  it('splits a paragraph at the caret', () => {
    const result = splitBlock(state([p({ text: 'ab', marks: ['em'] }, 'cd')], at([0], 2)));
    deepStrictEqual(result.doc, [p({ text: 'ab', marks: ['em'] }), p('cd')]);
    deepStrictEqual(caretOf(result), at([1], 0));
  });

  it('opens a paragraph after a heading or quote split at its end, keeping the block', () => {
    const heading = h(2, 'ab');
    const result = splitBlock(state([heading], at([0], 2)));
    deepStrictEqual(result.doc, [heading, p()]);
    strictEqual(result.doc[0], heading);
    deepStrictEqual(splitBlock(state([quote('a')], at([0], 1))).doc, [quote('a'), p()]);
  });

  it('keeps the kind for a split in the middle', () => {
    deepStrictEqual(splitBlock(state([h(3, 'ab')], at([0], 1))).doc, [h(3, 'a'), h(3, 'b')]);
  });

  it('opens an empty paragraph above a heading split at its start', () => {
    const heading = h(2, 'ab');
    const result = splitBlock(state([heading], at([0], 0)));
    deepStrictEqual(result.doc, [p(), heading]);
    strictEqual(result.doc[1], heading);
    deepStrictEqual(caretOf(result), at([1], 0));
  });

  it('moves a split item sublist to the new item', () => {
    const result = splitBlock(state([ul(li('ab', ul(li('c'))))], at([0, 0], 1)));
    deepStrictEqual(result.doc, [ul(li('a'), li('b', ul(li('c'))))]);
    deepStrictEqual(caretOf(result), at([0, 1], 0));
  });

  it('lifts an empty nested item', () => {
    const result = splitBlock(state([ul(li('a', ul(li([]))))], at([0, 0, 0], 0)));
    deepStrictEqual(result.doc, [ul(li('a'), li([]))]);
  });

  it('turns an empty top-level item into a paragraph, splitting the list around it', () => {
    const result = splitBlock(state([ol(li('a'), li([]), li('b'))], at([0, 1], 0)));
    deepStrictEqual(result.doc, [ol(li('a')), p(), ol(li('b'))]);
    deepStrictEqual(caretOf(result), at([1], 0));
  });

  it('deletes the selection first', () => {
    deepStrictEqual(splitBlock(state([p('abcd')], at([0], 1), at([0], 3))).doc, [p('a'), p('d')]);
  });

  it('inserts a line break in an inline value, or nothing without line breaks', () => {
    const inline = state([p('ab')], at([0], 1));
    deepStrictEqual(splitBlock(inline, { inline: true }).doc, [p('a\nb')]);
    strictEqual(splitBlock(inline, { inline: true, lineBreaks: false }), inline);
  });
});

describe('insertLineBreak', () => {
  const doc = [p('ab')];

  it('inserts a line break', () => {
    const result = insertLineBreak(state(doc, at([0], 1)));
    deepStrictEqual(result.doc, [p('a\nb')]);
    deepStrictEqual(caretOf(result), at([0], 2));
  });

  it('splits without line breaks, and does nothing inline', () => {
    deepStrictEqual(insertLineBreak(state(doc, at([0], 1)), { lineBreaks: false }).doc, [
      p('a'),
      p('b'),
    ]);
    const inline = state(doc, at([0], 1));
    strictEqual(insertLineBreak(inline, { inline: true, lineBreaks: false }), inline);
  });
});

describe('sinkItem', () => {
  it('nests an item and its sublist under the item before it', () => {
    const result = sinkItem(state([ul(li('a'), li('b', ul(li('c'))))], at([0, 1], 1)));
    deepStrictEqual(result?.doc, [ul(li('a', ul(li('b', ul(li('c'))))))]);
    deepStrictEqual(caretOf(result), at([0, 0, 0], 1));
  });

  it('appends to the sublist the item before already has', () => {
    const result = sinkItem(state([ul(li('a', ol(li('x'))), li('b'))], at([0, 1], 0)));
    deepStrictEqual(result?.doc, [ul(li('a', ol(li('x'), li('b'))))]);
  });

  it('sinks every selected item', () => {
    const doc = [ul(li('a'), li('b'), li('c'))];
    const result = sinkItem(state(doc, at([0, 1], 0), at([0, 2], 1)));
    deepStrictEqual(result?.doc, [ul(li('a', ul(li('b'), li('c'))))]);
  });

  it('sinks to the fourth level and no further', () => {
    const deep = [ul(li('a', ul(li('b', ul(li('c'), li('d'))))))];
    deepStrictEqual(sinkItem(state(deep, at([0, 0, 0, 1], 0)))?.doc, [
      ul(li('a', ul(li('b', ul(li('c', ul(li('d')))))))),
    ]);
    const deeper = [ul(li('a', ul(li('b', ul(li('c', ul(li('d'), li('e'))))))))];
    strictEqual(sinkItem(state(deeper, at([0, 0, 0, 0, 1], 0))), undefined);
    const subtree = [ul(li('a', ul(li('b', ul(li('c'), li('d', ul(li('e'))))))))];
    strictEqual(sinkItem(state(subtree, at([0, 0, 0, 1], 0))), undefined);
  });

  it('cannot sink a first item or a leaf outside a list', () => {
    strictEqual(sinkItem(state([ul(li('a'))], at([0, 0], 0))), undefined);
    strictEqual(sinkItem(state([ul(li('a', ul(li('b'))))], at([0, 0, 0], 0))), undefined);
    strictEqual(sinkItem(state([p('a')], at([0], 0))), undefined);
  });
});

describe('liftItem', () => {
  it('lifts a nested item, adopting the items after it', () => {
    const result = liftItem(state([ul(li('a', ul(li('b'), li('c'))))], at([0, 0, 0], 0)));
    deepStrictEqual(result?.doc, [ul(li('a'), li('b', ul(li('c'))))]);
    deepStrictEqual(caretOf(result), at([0, 1], 0));
  });

  it('turns a top-level item into a paragraph between two lists', () => {
    const result = liftItem(state([ul(li('a'), li('b'), li('c'))], at([0, 1], 0)));
    deepStrictEqual(result?.doc, [ul(li('a')), p('b'), ul(li('c'))]);
  });

  it('cannot lift outside a list', () => {
    strictEqual(liftItem(state([p('a')], at([0], 0))), undefined);
  });
});

describe('toggleList', () => {
  it('turns a paragraph into a list, joining a list of that kind on either side', () => {
    const doc = [ul(li('a')), p('b'), ul(li('c'))];
    const result = toggleList(state(doc, at([1], 1)), false);
    deepStrictEqual(result.doc, [ul(li('a'), li('b'), li('c'))]);
    deepStrictEqual(caretOf(result), at([0, 1], 1));
  });

  it('leaves a neighbouring list of the other kind apart', () => {
    const result = toggleList(state([ol(li('a')), p('b')], at([1], 0)), false);
    deepStrictEqual(result.doc, [ol(li('a')), ul(li('b'))]);
  });

  it('turns every selected leaf into one list', () => {
    const doc = [p('a'), h(2, 'b'), ul(li('c'))];
    const result = toggleList(state(doc, at([0], 0), at([2, 0], 1)), true);
    deepStrictEqual(result.doc, [ol(li('a'), li('b'), li('c'))]);
  });

  it('switches the whole level of a list of the other kind', () => {
    deepStrictEqual(toggleList(state([ol(li('a'), li('b'))], at([0, 0], 0)), false).doc, [
      ul(li('a'), li('b')),
    ]);
    deepStrictEqual(
      toggleList(state([ul(li('a', ol(li('b'), li('c'))))], at([0, 0, 1], 0)), false).doc,
      [ul(li('a', ul(li('b'), li('c'))))],
    );
  });

  it('turns items of that kind back into paragraphs', () => {
    const result = toggleList(state([ul(li('a'), li('b'), li('c'))], at([0, 1], 0)), false);
    deepStrictEqual(result.doc, [ul(li('a')), p('b'), ul(li('c'))]);
  });
});

describe('setBlockType', () => {
  it('gives each selected leaf the type', () => {
    const doc = [p('a'), quote('b'), p('c')];
    deepStrictEqual(setBlockType(state(doc, at([0], 0), at([1], 0)), 'h4').doc, [
      h(4, 'a'),
      h(4, 'b'),
      p('c'),
    ]);
    deepStrictEqual(setBlockType(state(doc, at([2], 0)), 'blockquote').doc, [
      p('a'),
      quote('b'),
      quote('c'),
    ]);
  });

  it('takes an item out of its list', () => {
    const result = setBlockType(state([ul(li('a'), li('b'))], at([0, 0], 1)), 'h2');
    deepStrictEqual(result.doc, [h(2, 'a'), ul(li('b'))]);
    deepStrictEqual(caretOf(result), at([0], 1));
  });
});

describe('toggleMark', () => {
  it('adds a mark to a partly marked selection, then removes it from all of it', () => {
    const doc = [p({ text: 'ab', marks: ['em'] }, 'cd')];
    const added = toggleMark(state(doc, at([0], 1), at([0], 3)), 'em');
    deepStrictEqual(added.doc, [p({ text: 'abc', marks: ['em'] }, 'd')]);
    deepStrictEqual(added.selection, { anchor: at([0], 1), head: at([0], 3) });
    deepStrictEqual(toggleMark(added, 'em').doc, [p({ text: 'a', marks: ['em'] }, 'bcd')]);
  });

  it('marks text across leaves', () => {
    const result = toggleMark(state([p('ab'), ul(li('cd'))], at([0], 1), at([1, 0], 1)), 'code');
    deepStrictEqual(result.doc, [
      p('a', { text: 'b', marks: ['code'] }),
      ul(li([{ text: 'c', marks: ['code'] }, 'd'])),
    ]);
  });

  it('toggles a stored mark on a caret', () => {
    const doc = [p({ text: 'a', marks: ['strong'] })];
    const off = toggleMark(state(doc, at([0], 1)), 'strong');
    deepStrictEqual(off.storedMarks, []);
    strictEqual(off.doc, doc);
    deepStrictEqual(insertText(off, 'b').doc, [p({ text: 'a', marks: ['strong'] }, 'b')]);
    deepStrictEqual(toggleMark(off, 'strong').storedMarks, ['strong']);
  });
});

describe('clearMarks', () => {
  it('removes marks and keeps links', () => {
    const doc = [p({ text: 'ab', marks: ['strong', 'em'], link: LINK })];
    deepStrictEqual(clearMarks(state(doc, at([0], 0), at([0], 1))).doc, [
      p({ text: 'a', link: LINK }, { text: 'b', marks: ['strong', 'em'], link: LINK }),
    ]);
  });

  it('stores no marks on a caret', () => {
    const doc = [p({ text: 'a', marks: ['strong'] })];
    deepStrictEqual(insertText(clearMarks(state(doc, at([0], 1))), 'b').doc, [
      p({ text: 'a', marks: ['strong'] }, 'b'),
    ]);
  });
});

describe('setLink and removeLink', () => {
  const next: Link = { collection: 'Pages', record: PAGE };

  it('links the selected text', () => {
    deepStrictEqual(setLink(state([p('abc')], at([0], 1), at([0], 2)), LINK).doc, [
      p('a', { text: 'b', link: LINK }, 'c'),
    ]);
  });

  it('points a whole link at a new target from a caret inside it', () => {
    const doc = [p('x', { text: 'ab', link: LINK }, { text: 'c', link: LINK, marks: ['em'] }, 'y')];
    deepStrictEqual(setLink(state(doc, at([0], 2)), next).doc, [
      p('x', { text: 'ab', link: next }, { text: 'c', link: next, marks: ['em'] }, 'y'),
    ]);
  });

  it('inserts linked text at a caret outside a link, and nothing without text', () => {
    const result = setLink(state([p('ab')], at([0], 1)), LINK, 'go');
    deepStrictEqual(result.doc, [p('a', { text: 'go', link: LINK }, 'b')]);
    deepStrictEqual(caretOf(result), at([0], 3));
    const bare = state([p('ab')], at([0], 1));
    strictEqual(setLink(bare, LINK), bare);
  });

  it('removes a whole link from a caret, and links within a selection', () => {
    const doc = [p('x', { text: 'abc', link: LINK })];
    deepStrictEqual(removeLink(state(doc, at([0], 2))).doc, [p('xabc')]);
    deepStrictEqual(removeLink(state(doc, at([0], 0), at([0], 2))).doc, [
      p('xa', { text: 'bc', link: LINK }),
    ]);
    const plain = state([p('a')], at([0], 1));
    strictEqual(removeLink(plain), plain);
  });
});

describe('insertSlice', () => {
  it('inserts a single leaf into the current one', () => {
    const result = insertSlice(state([h(2, 'ab')], at([0], 1)), [p({ text: 'X', marks: ['em'] })]);
    deepStrictEqual(result.doc, [h(2, 'a', { text: 'X', marks: ['em'] }, 'b')]);
    deepStrictEqual(caretOf(result), at([0], 2));
  });

  it('continues the current leaf with the first block and ends with the last', () => {
    const result = insertSlice(state([p('abcd')], at([0], 2)), [p('X'), quote('M'), h(2, 'Y')]);
    deepStrictEqual(result.doc, [p('abX'), quote('M'), h(2, 'Ycd')]);
    deepStrictEqual(caretOf(result), at([2], 1));
  });

  it('gives an empty paragraph the type of the slice', () => {
    deepStrictEqual(insertSlice(state([p()], at([0], 0)), [h(3, 'X')]).doc, [h(3, 'X')]);
    deepStrictEqual(insertSlice(state([p()], at([0], 0)), [ol(li('X'))]).doc, [ol(li('X'))]);
  });

  it('fits a slice into the list around the caret', () => {
    const result = insertSlice(state([ul(li('abcd'))], at([0, 0], 2)), [
      p('X'),
      ol(li('Y', ol(li('Z')))),
    ]);
    deepStrictEqual(result.doc, [ul(li('abX'), li('Y', ol(li('Zcd'))))]);
    deepStrictEqual(caretOf(result), at([0, 1, 0], 1));
  });

  it('never puts one object in the document twice', () => {
    const slice = [p('X'), p('Y'), ul(li('Z')), p('W')];
    let result = insertSlice(state([p('ab')], at([0], 1)), slice);
    result = insertSlice(result, slice);
    assertUnique(result.doc);
  });
});

describe('markdownShortcut', () => {
  const typed = (marker: string, options?: RichTextOptions, before: RichText = []) =>
    markdownShortcut(
      state([...before, p(marker, 'rest')], at([before.length], marker.length)),
      options,
    );

  it('turns `#` into the highest allowed heading', () => {
    deepStrictEqual(typed('#')?.doc, [h(2, 'rest')]);
    deepStrictEqual(typed('#', { elements: ['h4', 'h5'] })?.doc, [h(4, 'rest')]);
  });

  it('turns `##` to `######` into that heading level', () => {
    for (const level of [2, 3, 4, 5, 6] as const) {
      deepStrictEqual(typed('#'.repeat(level), PERMISSIVE)?.doc, [h(level, 'rest')]);
    }
  });

  it('turns `-`, `*` and `+` into a bulleted list, and `1.` and `1)` into a numbered one', () => {
    for (const marker of ['-', '*', '+']) deepStrictEqual(typed(marker)?.doc, [ul(li('rest'))]);
    for (const marker of ['1.', '1)']) deepStrictEqual(typed(marker)?.doc, [ol(li('rest'))]);
  });

  it('turns `>` into a quote', () => {
    const result = typed('>');
    deepStrictEqual(result?.doc, [quote('rest')]);
    deepStrictEqual(caretOf(result), at([0], 0));
  });

  it('joins a list of the same kind before it', () => {
    deepStrictEqual(typed('-', {}, [ul(li('a'))])?.doc, [ul(li('a'), li('rest'))]);
  });

  it('fires only for an allowed result, exactly the marker, in a paragraph of a block value', () => {
    strictEqual(typed('####'), undefined);
    strictEqual(typed('#######', PERMISSIVE), undefined);
    strictEqual(typed('-', { elements: ['ol'] }), undefined);
    strictEqual(typed('-', { inline: true }), undefined);
    strictEqual(typed('a-'), undefined);
    strictEqual(typed('2.'), undefined);
    strictEqual(markdownShortcut(state([h(2, '-')], at([0], 1))), undefined);
    strictEqual(markdownShortcut(state([ul(li('-'))], at([0, 0], 1))), undefined);
    strictEqual(markdownShortcut(state([p('##')], at([0], 0), at([0], 2))), undefined);
  });

  it('restores the marker as text on Backspace right after', () => {
    const result = typed('##');
    ok(result);
    const undone = deleteBackward(result);
    deepStrictEqual(undone.doc, [p('## rest')]);
    deepStrictEqual(caretOf(undone), at([0], 3));
  });

  it('expires the restore once the document or the caret changes', () => {
    const result = typed('-');
    ok(result);
    const edited = deleteBackward(insertText(result, 'x'));
    deepStrictEqual(edited.doc, [ul(li('rest'))]);
    const moved = deleteBackward({
      ...result,
      selection: { anchor: at([0, 0], 2), head: at([0, 0], 2) },
    });
    deepStrictEqual(moved.doc, [ul(li('rst'))]);
  });
});

describe('every command', () => {
  const OPTION_SETS: RichTextOptions[] = [
    PERMISSIVE,
    {},
    { inline: true },
    { inline: true, lineBreaks: false, marks: ['em'], links: false },
    { elements: ['ul', 'h3'], marks: ['strong'], links: false, lineBreaks: false },
    { elements: ['ol', 'blockquote', 'h6'], links: ['Pages'] },
  ];

  it('keeps a valid value valid once normalized, leaves its input, and never repeats an object', () => {
    const random = mulberry32(7);
    for (const options of OPTION_SETS) {
      for (let round = 0; round < 60; round++) {
        let current = createRichTextState(randomDoc(random, options));
        for (let step = 0; step < 6; step++) {
          current = { ...current, selection: randomSelection(random, current.doc) };
          const snapshot = structuredClone(current.doc);
          const [name, command] = pick(random, commands(random, options));
          const next = command(current) ?? current;
          const where = `${name} under ${JSON.stringify(options)} on ${JSON.stringify(snapshot)}`;
          deepStrictEqual(current.doc, snapshot, `${where} mutated its input`);
          deepStrictEqual(checkRichText(normalizeRichText(next.doc, options), options), [], where);
          ok(leaves(next.doc).length > 0, `${where} left no leaf`);
          for (const pos of [next.selection.anchor, next.selection.head]) {
            deepStrictEqual(clampPos(next.doc, pos), pos, `${where} left the selection off a leaf`);
          }
          assertUnique(next.doc, where);
          current = next;
        }
      }
    }
  });
});

type Random = () => number;
type Command = (state: RichTextState) => RichTextState | undefined;

function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function count(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function allowed(options: RichTextOptions) {
  const {
    inline = false,
    elements = ['h2', 'h3', 'ul', 'ol', 'blockquote'],
    marks = ['strong', 'em', 'code'],
    links = true,
    lineBreaks = true,
  } = options;
  return { inline, elements, marks, links, lineBreaks };
}

function randomRuns(random: Random, options: RichTextOptions): RichTextRun[] {
  const { marks, links, lineBreaks } = allowed(options);
  const texts = [
    'a',
    'bc',
    ' ',
    '#',
    '##',
    '-',
    '1.',
    '>',
    'é',
    '😀',
    ...(lineBreaks ? ['\n'] : []),
  ];
  const targets: Link[] = [
    ...(links === false ? [] : [LINK, { url: 'https://x.y', newTab: true }]),
    ...(Array.isArray(links) ? [{ collection: 'Pages', record: PAGE }] : []),
  ];
  return Array.from({ length: count(random, 0, 4) }, () => {
    const run: RichTextRun = { text: pick(random, texts) };
    const picked = marks.filter(() => random() < 0.3);
    if (picked.length > 0) run.marks = [...picked];
    if (targets.length > 0 && random() < 0.3) run.link = pick(random, targets);
    return run;
  });
}

function randomItems(random: Random, options: RichTextOptions, depth: number): RichTextListItem[] {
  const types = listTypes(options);
  return Array.from({ length: count(random, 1, 3) }, () => {
    const item: RichTextListItem = { content: randomRuns(random, options) };
    if (depth < 3 && random() < 0.4) {
      item.list = {
        kind: 'list',
        ordered: pick(random, types),
        items: randomItems(random, options, depth + 1),
      };
    }
    return item;
  });
}

function listTypes(options: RichTextOptions): boolean[] {
  const { elements } = allowed(options);
  return [...(elements.includes('ul') ? [false] : []), ...(elements.includes('ol') ? [true] : [])];
}

function blockTypes(options: RichTextOptions) {
  const { elements } = allowed(options);
  return (['h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'] as const).filter((type) =>
    elements.includes(type),
  );
}

function randomDoc(random: Random, options: RichTextOptions): RichText {
  if (allowed(options).inline) return [{ kind: 'paragraph', content: randomRuns(random, options) }];
  return Array.from({ length: count(random, 1, 4) }, (): RichTextBlock => {
    const kind = pick(random, ['paragraph', 'paragraph', 'block', 'list']);
    const types = listTypes(options);
    if (kind === 'list' && types.length > 0) {
      return { kind: 'list', ordered: pick(random, types), items: randomItems(random, options, 0) };
    }
    const content = randomRuns(random, options);
    const type =
      blockTypes(options).length > 0 && kind === 'block' ? pick(random, blockTypes(options)) : 'p';
    if (type === 'p') return { kind: 'paragraph', content };
    if (type === 'blockquote') return { kind: 'quote', content };
    return { kind: 'heading', level: Number(type[1]) as 2, content };
  });
}

function randomPos(random: Random, doc: RichText): Pos {
  const { path, leaf } = pick(random, leaves(doc));
  const length = leaf.content.reduce((sum, run) => sum + run.text.length, 0);
  return { path, offset: count(random, 0, length) };
}

function randomSelection(random: Random, doc: RichText) {
  const anchor = randomPos(random, doc);
  return { anchor, head: random() < 0.5 ? anchor : randomPos(random, doc) };
}

function commands(random: Random, options: RichTextOptions): [string, Command][] {
  const { inline, marks, links, lineBreaks } = allowed(options);
  const block = inline ? [] : blockTypes(options);
  const slice = conformRichText(randomDoc(random, PERMISSIVE), options);
  const link: Link = Array.isArray(links) ? { collection: 'Pages', record: PAGE } : LINK;
  return [
    ['insertText', (state) => insertText(state, 'x')],
    ...(lineBreaks
      ? [['insertText \\n', (state) => insertText(state, '\n')] as [string, Command]]
      : []),
    [
      'replaceText',
      (state) => replaceText(state, state.selection.head, state.selection.anchor, 'yz'),
    ],
    ['deleteSelection', deleteSelection],
    ['deleteBackward', deleteBackward],
    ['deleteForward', deleteForward],
    ['splitBlock', (state) => splitBlock(state, options)],
    ['insertLineBreak', (state) => insertLineBreak(state, options)],
    ['sinkItem', sinkItem],
    ['liftItem', liftItem],
    ...listTypes(inline ? { elements: [] } : options).map((ordered): [string, Command] => [
      `toggleList ${ordered}`,
      (state) => toggleList(state, ordered),
    ]),
    ...['p' as const, ...block].map((type): [string, Command] => [
      `setBlockType ${type}`,
      (state) => (inline ? state : setBlockType(state, type)),
    ]),
    ...marks.map((mark): [string, Command] => [
      `toggleMark ${mark}`,
      (state) => insertText(toggleMark(state, mark as RichTextMark), 'm'),
    ]),
    ['clearMarks', clearMarks],
    ...(links === false
      ? []
      : [['setLink', (state) => setLink(state, link, 'go')] as [string, Command]]),
    ['removeLink', removeLink],
    ['insertSlice', (state) => insertSlice(state, slice)],
    ['markdownShortcut', (state) => markdownShortcut(state, options)],
    [
      'markdownShortcut then Backspace',
      (state) => {
        const fired = markdownShortcut(state, options);
        return fired && deleteBackward(fired);
      },
    ],
  ];
}

function assertUnique(doc: RichText, message?: string): void {
  const seen = new Set<object>();
  const visit = (node: object) => {
    ok(!seen.has(node), message ?? 'an object appears twice');
    seen.add(node);
  };
  const visitList = (list: RichTextList) => {
    visit(list);
    for (const item of list.items) {
      visit(item);
      if (item.list) visitList(item.list);
    }
  };
  for (const block of doc) {
    if (block.kind === 'list') visitList(block);
    else visit(block);
  }
}
