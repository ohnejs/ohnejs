import { last } from '../../utils/array/last.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';

/**
 * One inline run of markdown-lite: plain text, bold, code, a link, or a line break.
 */
export type ProseInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'break' };

/**
 * One pipe table row: the inline runs of each cell.
 */
export type ProseRow = ProseInline[][];

/**
 * One block of markdown-lite: a paragraph, a blockquote, a code fence, or a pipe table.
 * A table's `head` is `null` when every header cell is empty.
 */
export type ProseBlock =
  | { kind: 'paragraph'; content: ProseInline[] }
  | { kind: 'quote'; content: ProseInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: ProseRow | null; rows: ProseRow[] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCE = /```\w*\n?([\s\S]*?)```/g;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Reads one inline token: bold, code, or a link.
 * A link whose URL is not `http(s)` stays literal text.
 * With `links` off, a link is its label.
 */
function inlineToken(token: RegExpExecArray, links: boolean): ProseInline {
  if (!isUndefined(token[1])) return { kind: 'strong', text: token[1] };
  if (!isUndefined(token[2])) return { kind: 'code', text: token[2] };
  const href = token[4]!;
  if (!/^https?:\/\//.test(href)) return { kind: 'text', text: token[0] };
  return links ? { kind: 'link', text: token[3]!, href } : { kind: 'text', text: token[3]! };
}

/**
 * Parses `text` through the inline grammar, one `break` per line break.
 * Adjacent text merges into one run, so a link kept as text joins the text around it.
 */
function parseInline(text: string, links: boolean): ProseInline[] {
  const content: ProseInline[] = [];
  const push = (run: ProseInline) => {
    const previous = last(content);
    if (run.kind === 'text' && previous?.kind === 'text') previous.text += run.text;
    else content.push(run);
  };
  text.split('\n').forEach((line, index) => {
    if (index > 0) push({ kind: 'break' });
    let cursor = 0;
    for (const token of line.matchAll(INLINE)) {
      if (token.index > cursor) push({ kind: 'text', text: line.slice(cursor, token.index) });
      push(inlineToken(token, links));
      cursor = token.index + token[0].length;
    }
    if (cursor < line.length) push({ kind: 'text', text: line.slice(cursor) });
  });
  return content;
}

/**
 * Splits a pipe row into trimmed cells, dropping the leading edge and an empty trailing edge.
 */
function rowCells(line: string): string[] {
  const cells = line.split('|').map((cell) => cell.trim());
  cells.shift();
  if (last(cells) === '') cells.pop();
  return cells;
}

/**
 * Whether a block is a pipe table: every line starts with `|` and the second is a separator row.
 */
function isTable(lines: string[]): boolean {
  if (lines.length < 2 || !lines.every((line) => line.startsWith('|'))) return false;
  const separator = rowCells(lines[1]!);
  return !isEmpty(separator) && separator.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * Parses a pipe table, each cell through the inline grammar.
 * A header whose every cell is empty parses to a `null` head, so a `|||` row hides the header.
 */
function parseTable(lines: string[], links: boolean): ProseBlock {
  const [header = [], , ...rows] = lines.map(rowCells);
  const cells = (row: string[]) => row.map((cell) => parseInline(cell, links));
  return {
    kind: 'table',
    head: header.some((cell) => cell !== '') ? cells(header) : null,
    rows: rows.map(cells),
  };
}

/**
 * Parses the blocks of `text`, split on blank lines, as blockquotes, tables, and paragraphs.
 */
function parseBlocks(text: string, links: boolean): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    if (lines.every((line) => line.startsWith('>'))) {
      const quoted = lines.map((line) => line.replace(/^> ?/, '')).join('\n');
      blocks.push({ kind: 'quote', content: parseInline(quoted, links) });
    } else if (isTable(lines)) {
      blocks.push(parseTable(lines, links));
    } else {
      blocks.push({ kind: 'paragraph', content: parseInline(trimmed, links) });
    }
  }
  return blocks;
}

/**
 * Parses markdown-lite `text` into blocks, the DOM-free half of `renderProse`.
 * With `links` off, a link parses to its label as plain text.
 */
export function parseProse(text: string, links: boolean): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let cursor = 0;
  for (const fence of text.matchAll(FENCE)) {
    blocks.push(...parseBlocks(text.slice(cursor, fence.index), links));
    blocks.push({ kind: 'code', text: fence[1] ?? '' });
    cursor = fence.index + fence[0].length;
  }
  blocks.push(...parseBlocks(text.slice(cursor), links));
  return blocks;
}
