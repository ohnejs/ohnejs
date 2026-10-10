import { codeSpanText } from '../../utils/ansi/code-span-text.ts';
import { codeSpans } from '../../utils/ansi/code-spans.ts';
import { last } from '../../utils/array/last.ts';
import { nextIndexes } from '../../utils/array/next-indexes.ts';
import { isSafeHref } from '../../utils/html/is-safe-href.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { isLocalPath } from '../../utils/route/is-local-path.ts';

/**
 * One inline run of markdown-lite: text, code, an emphasis, a link, or a line break.
 * An emphasis and a link hold inline runs of their own.
 */
export type ProseInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong' | 'em' | 'del'; content: ProseInline[] }
  | { kind: 'link'; href: string; local: boolean; content: ProseInline[] }
  | { kind: 'break' };

/**
 * One pipe table row: the inline runs of each cell.
 */
export type ProseRow = ProseInline[][];

/**
 * How a pipe table column aligns its cells, read off its separator cell.
 */
export type ProseAlign = 'start' | 'center' | 'end';

/**
 * One list item: its own text, then the blocks nested under it.
 */
export interface ProseItem {
  /**
   * The inline runs of the item's first paragraph.
   */
  content: ProseInline[];

  /**
   * Whether a task item is checked; `null` for an item that is not a task.
   */
  checked: boolean | null;

  /**
   * The blocks indented under the item, such as a nested list.
   */
  children: ProseBlock[];
}

/**
 * One block of markdown-lite: a paragraph, a heading, a list, a blockquote, a code fence, a table, or a rule.
 * A table's `head` is `null` when every header cell is empty.
 */
export type ProseBlock =
  | { kind: 'paragraph'; content: ProseInline[] }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: ProseInline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ProseItem[] }
  | { kind: 'quote'; blocks: ProseBlock[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: ProseRow | null; align: ProseAlign[]; rows: ProseRow[] }
  | { kind: 'rule' };

/**
 * Which links render: every web and local link `isSafeHref` admits, only local paths, or none.
 */
type Links = boolean | 'local';

/**
 * An inline token: the offset just past it, and the runs it reads as.
 */
type Token = [end: number, runs: ProseInline[]];

/**
 * An emphasis mark.
 */
type Mark = '**' | '__' | '~~' | '*' | '_';

const EMPHASIS: readonly [Mark, 'strong' | 'em' | 'del'][] = [
  ['**', 'strong'],
  ['__', 'strong'],
  ['~~', 'del'],
  ['*', 'em'],
  ['_', 'em'],
];
const ESCAPABLE = /^[!-/:-@[-`{-~]$/;
const DOT = /./u;
const SPACE = /\s/;
const WORD_AFTER = /(?=[\p{L}\p{N}])/uy;
const WORD_BEFORE = /(?<=[\p{L}\p{N}])/uy;
const WEB = /^https?:/i;
const BLANK = /^\s*$/;
const INDENT = /^ */;
const FENCE_OPEN = /^ {0,3}(`{3,})[^`]*$/;
const FENCE_CLOSE = /^ {0,3}(`{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const QUOTE_MARK = /^ {0,3}> ?/;
const MAX_QUOTES = 100;
const TABLE_ROW = /^ {0,3}\|/;
const CELL_BAR = /(?<!\\)\|/g;
const SEPARATOR_CELL = /^:?-+:?$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const TASK = /^\[([ xX])\]\s+/;

/**
 * Appends `run` to `content`, merging it into a text run just before it.
 */
function push(content: ProseInline[], run: ProseInline): void {
  const previous = last(content);
  if (run.kind === 'text' && previous?.kind === 'text') previous.text += run.text;
  else content.push(run);
}

/**
 * Parses one line through the inline grammar in linear time, code spans binding first.
 * At each offset the first rule that matches wins: an escape, a span, an image, a link, then an emphasis.
 * An emphasis closes at the first closing mark after it, and a link label at the first `]`.
 * An image reads as its alt text, so a model-chosen URL is never fetched.
 * A link the `links` mode refuses reads as its label.
 */
function parseLine(line: string, links: Links): ProseInline[] {
  const { ends, masked } = codeSpans(line, true);
  const isAt = (pattern: RegExp, index: number) => pattern.test(masked[index] ?? '');
  const matchesAt = (pattern: RegExp, index: number) => {
    pattern.lastIndex = index;
    return pattern.test(masked);
  };
  const isWord = (index: number) => matchesAt(WORD_AFTER, index);
  const isWordBefore = (index: number) => matchesAt(WORD_BEFORE, index);
  const next = (found: (index: number) => boolean) => nextIndexes(masked.length, found);
  const breaks = next((index) => !isAt(DOT, index));
  const brackets = next((index) => masked[index] === ']');
  const hrefEnds = next((index) => masked[index] === ')' || isAt(SPACE, index));
  const closers: Record<Mark, (from: number) => number> = {
    '**': next((index) => masked.startsWith('**', index)),
    __: next((index) => masked.startsWith('__', index) && !isWord(index + 2)),
    '~~': next((index) => masked.startsWith('~~', index)),
    '*': next((index) => masked[index] === '*' && !isAt(SPACE, index - 1)),
    _: next((index) => masked[index] === '_' && !isAt(SPACE, index - 1) && !isWord(index + 1)),
  };

  const link = (index: number, end: number): Token | undefined => {
    const open = masked.startsWith('![', index) ? index + 1 : index;
    if (masked[open] !== '[') return undefined;
    const close = brackets(open + 1);
    const labeled = open > index || close > open + 1;
    if (!labeled || close + 1 >= end || masked[close + 1] !== '(') return undefined;
    const hrefEnd = hrefEnds(close + 2);
    if (hrefEnd === close + 2 || hrefEnd >= end || masked[hrefEnd] !== ')') return undefined;
    const label = line.slice(open + 1, close);
    if (open > index) return [hrefEnd + 1, isEmpty(label) ? [] : [{ kind: 'text', text: label }]];
    const href = line.slice(close + 2, hrefEnd);
    const local = isLocalPath(href);
    const accepted =
      isSafeHref(href) &&
      (local || WEB.test(href)) &&
      (links === true || (links === 'local' && local));
    const content = parse(open + 1, close);
    return [hrefEnd + 1, accepted ? [{ kind: 'link', href, local, content }] : content];
  };

  const emphasis = (index: number, end: number): Token | undefined => {
    for (const [mark, kind] of EMPHASIS) {
      const start = index + mark.length;
      const opens =
        masked.startsWith(mark, index) &&
        !(mark[0] === '_' && isWordBefore(index)) &&
        !(mark.length === 1 && isAt(SPACE, start)) &&
        start < end;
      const close = opens ? closers[mark](start + 1) : end;
      if (close + mark.length <= end && breaks(start) >= close) {
        return [close + mark.length, [{ kind, content: parse(start, close) }]];
      }
    }
    return undefined;
  };

  const token = (index: number, end: number): Token | undefined => {
    const char = masked[index]!;
    if (char === '\\') {
      const escaped = line[index + 1] ?? '';
      return index + 1 < end && ESCAPABLE.test(escaped)
        ? [index + 2, [{ kind: 'text', text: escaped }]]
        : undefined;
    }
    if (char === '`') {
      const span = ends.get(index);
      if (isUndefined(span)) return undefined;
      return [span, [{ kind: 'code', text: codeSpanText(line.slice(index, span)) }]];
    }
    if (char === '!' || char === '[') return link(index, end);
    return '*_~'.includes(char) ? emphasis(index, end) : undefined;
  };

  // Nested content reuses the line's tables, since a lookaround at a content edge sees a mark either way.
  const parse = (start: number, end: number): ProseInline[] => {
    const content: ProseInline[] = [];
    let cursor = start;
    for (let index = start; index < end; ) {
      const found = token(index, end);
      if (isUndefined(found)) {
        index++;
        continue;
      }
      if (index > cursor) push(content, { kind: 'text', text: line.slice(cursor, index) });
      for (const run of found[1]) push(content, run);
      index = cursor = found[0];
    }
    if (cursor < end) push(content, { kind: 'text', text: line.slice(cursor, end) });
    return content;
  };

  return parse(0, line.length);
}

/**
 * Parses `text` through the inline grammar, one `break` per line break.
 */
function parseInline(text: string, links: Links): ProseInline[] {
  const content: ProseInline[] = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0) content.push({ kind: 'break' });
    for (const run of parseLine(line, links)) push(content, run);
  });
  return content;
}

/**
 * How many spaces `line` starts with.
 */
function indentOf(line: string): number {
  return INDENT.exec(line)![0].length;
}

/**
 * Splits a pipe row into trimmed cells, dropping the leading edge and an empty trailing edge.
 * A `|` escaped by `\` or inside a closed backtick span stays in its cell.
 */
function rowCells(line: string): string[] {
  const row = line.trim();
  const cells: string[] = [];
  let start = 0;
  for (const { index } of codeSpans(row, true).masked.matchAll(CELL_BAR)) {
    cells.push(row.slice(start, index).trim());
    start = index + 1;
  }
  cells.push(row.slice(start).trim());
  cells.shift();
  if (last(cells) === '') cells.pop();
  return cells;
}

/**
 * Whether a pipe table starts at `index`: a `|` row, then a separator row.
 */
function isTableAt(lines: readonly string[], index: number): boolean {
  const next = lines[index + 1];
  if (!TABLE_ROW.test(lines[index]!) || isUndefined(next) || !TABLE_ROW.test(next)) return false;
  const separator = rowCells(next);
  return !isEmpty(separator) && separator.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * Parses a pipe table, each cell through the inline grammar.
 * A header whose every cell is empty parses to a `null` head, so a `|||` row hides the header.
 */
function parseTable(lines: readonly string[], links: Links): ProseBlock {
  const [header = [], separator = [], ...rows] = lines.map(rowCells);
  const cells = (row: string[]) => row.map((cell) => parseInline(cell, links));
  return {
    kind: 'table',
    head: header.some((cell) => cell !== '') ? cells(header) : null,
    align: separator.map((cell) =>
      cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'end') : 'start',
    ),
    rows: rows.map(cells),
  };
}

/**
 * The list item marker on `line`, unless the line is a rule such as `* * *`.
 */
function itemAt(line: string): RegExpExecArray | null {
  return RULE.test(line) ? null : ITEM.exec(line);
}

/**
 * Whether a list marker is a number.
 */
function isOrdered(marker: string): boolean {
  return /^\d/.test(marker);
}

/**
 * Whether the line at `index` opens a block other than a paragraph, which ends a paragraph before it.
 */
function opens(lines: readonly string[], index: number): boolean {
  const line = lines[index]!;
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    isTableAt(lines, index) ||
    ITEM.test(line)
  );
}

/**
 * The index of the first non-blank line at or after `index`, or the line count when none is left.
 */
function nextFilled(lines: readonly string[], index: number): number {
  let next = index;
  while (next < lines.length && BLANK.test(lines[next]!)) next++;
  return next;
}

/**
 * Parses one list item from its first line and the body lines under it, already outdented.
 * Body lines up to a blank line or a new block continue the item's text; the rest are its children.
 */
function parseItem(
  first: string,
  body: readonly string[],
  links: Links,
  quotes: number,
): ProseItem {
  const task = TASK.exec(first);
  const text = [isNull(task) ? first : first.slice(task[0].length)];
  let index = 0;
  while (index < body.length && !BLANK.test(body[index]!) && !opens(body, index)) {
    text.push(body[index++]!.trim());
  }
  return {
    content: parseInline(text.join('\n'), links),
    checked: isNull(task) ? null : task[1] !== ' ',
    children: parseBlocks(body.slice(index), links, quotes),
  };
}

/**
 * Parses the list starting at `index`, returning it and the index after it.
 * Items share the first item's indent and kind; a line indented to an item's content column belongs to it.
 * A blank line keeps the list open only before an indented line or a sibling item.
 */
function parseList(
  lines: readonly string[],
  index: number,
  links: Links,
  quotes: number,
): [ProseBlock, number] {
  const first = ITEM.exec(lines[index]!)!;
  const indent = first[1]!.length;
  const ordered = isOrdered(first[2]!);
  const sibling = (line: string | undefined): RegExpExecArray | null => {
    const match = isUndefined(line) ? null : itemAt(line);
    return match?.[1]!.length === indent && isOrdered(match[2]!) === ordered ? match : null;
  };
  const items: ProseItem[] = [];
  let cursor = index;
  for (let match = sibling(lines[cursor]); !isNull(match); ) {
    const column = match[0].length - match[4]!.length;
    let end = cursor + 1;
    for (; end < lines.length; end++) {
      const line = lines[end]!;
      if (BLANK.test(line)) {
        const next = nextFilled(lines, end);
        if (next === lines.length || indentOf(lines[next]!) < column) break;
      } else if (indentOf(line) < column && opens(lines, end)) {
        break;
      }
    }
    const body = lines
      .slice(cursor + 1, end)
      .map((line) => line.slice(Math.min(column, indentOf(line))));
    items.push(parseItem(match[4]!, body, links, quotes));
    cursor = end;
    match = sibling(lines[nextFilled(lines, end)]);
    if (!isNull(match)) cursor = nextFilled(lines, end);
  }
  const start = ordered ? Number.parseInt(first[2]!, 10) : 1;
  return [{ kind: 'list', ordered, start, items }, cursor];
}

/**
 * Whether `line` closes a code fence opened by `fence`: a bare backtick run at least as long.
 */
function closesFence(line: string, fence: string): boolean {
  return (FENCE_CLOSE.exec(line)?.[1]!.length ?? 0) >= fence.length;
}

/**
 * Parses the block starting at the non-blank line `index`, returning it and the index after it.
 * Quotes nest at most `MAX_QUOTES` deep, so hostile input cannot overflow the call stack.
 * A deeper `>` line reads as a paragraph.
 */
function parseBlock(
  lines: readonly string[],
  index: number,
  links: Links,
  quotes: number,
): [ProseBlock, number] {
  const line = lines[index]!;
  const fence = FENCE_OPEN.exec(line);
  if (!isNull(fence)) {
    let end = index + 1;
    while (end < lines.length && !closesFence(lines[end]!, fence[1]!)) end++;
    return [{ kind: 'code', text: lines.slice(index + 1, end).join('\n') }, end + 1];
  }
  const heading = HEADING.exec(line);
  if (!isNull(heading)) {
    const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
    return [{ kind: 'heading', level, content: parseInline(heading[2]!, links) }, index + 1];
  }
  if (RULE.test(line)) return [{ kind: 'rule' }, index + 1];
  let end = index + 1;
  if (QUOTE.test(line) && quotes < MAX_QUOTES) {
    while (end < lines.length && QUOTE.test(lines[end]!)) end++;
    const quoted = lines.slice(index, end).map((row) => row.replace(QUOTE_MARK, ''));
    return [{ kind: 'quote', blocks: parseBlocks(quoted, links, quotes + 1) }, end];
  }
  if (isTableAt(lines, index)) {
    while (end < lines.length && TABLE_ROW.test(lines[end]!)) end++;
    return [parseTable(lines.slice(index, end), links), end];
  }
  if (ITEM.test(line)) return parseList(lines, index, links, quotes);
  while (end < lines.length && !BLANK.test(lines[end]!) && !opens(lines, end)) end++;
  const text = lines.slice(index, end).map((row) => row.trim());
  return [{ kind: 'paragraph', content: parseInline(text.join('\n'), links) }, end];
}

/**
 * Parses `lines` into blocks, one scan from top to bottom.
 */
function parseBlocks(lines: readonly string[], links: Links, quotes: number): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  for (let index = nextFilled(lines, 0); index < lines.length; ) {
    const [block, next] = parseBlock(lines, index, links, quotes);
    blocks.push(block);
    index = nextFilled(lines, next);
  }
  return blocks;
}

/**
 * Parses markdown-lite `text` into blocks, the DOM-free half of `renderProse`.
 * With `links` as `'local'`, only a link to a local path stays a link.
 * With `links` off, every link parses to its label.
 */
export function parseProse(text: string, links: boolean | 'local'): ProseBlock[] {
  return parseBlocks(text.split(/\r?\n/), links, 0);
}
