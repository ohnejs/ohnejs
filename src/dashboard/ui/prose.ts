import type { Child } from '../render/insert.ts';

import { last } from '../../utils/array/last.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `prose`.
 */
export interface ProseOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Spacing step between elements and text: -2 very tight, -1 tight, 0 default, 1 loose, 2 very loose.
   * Omitted inherits `--ohne-spacing` from the nearest ancestor.
   */
  spacing?: number;
}

/**
 * A typographic flow container.
 * Wraps rich content in the foundation's `ohne-prose` class, which supplies the vertical rhythm.
 *
 * @example
 * ```ts
 * prose([h('h2', null, 'Title'), h('p', null, 'Body text.')], { spacing: -1 })
 * ```
 */
export function prose(content: Child, options: ProseOptions = {}): HTMLElement {
  const style = [
    options.size === undefined ? '' : `--ohne-size: ${options.size}`,
    options.spacing === undefined ? '' : `--ohne-spacing: ${options.spacing}`,
  ]
    .filter(Boolean)
    .join('; ');
  return h('div', { class: 'ohne-prose', style: style || undefined }, content);
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCE = /```\w*\n?([\s\S]*?)```/g;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Builds the node for one inline token: bold, code, or a link.
 * A link whose URL is not `http(s)` stays literal text.
 */
function inlineNode(token: RegExpExecArray): Node {
  if (!isUndefined(token[1])) {
    const strong = document.createElement('strong');
    strong.textContent = token[1];
    return strong;
  }
  if (!isUndefined(token[2])) {
    const code = document.createElement('code');
    code.textContent = token[2];
    return code;
  }
  const url = token[4]!;
  if (!/^https?:\/\//.test(url)) return document.createTextNode(token[0]);
  const anchor = document.createElement('a');
  anchor.textContent = token[3]!;
  anchor.setAttribute('href', url);
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
  return anchor;
}

/**
 * Renders `text` through the inline grammar into `target`, one `br` per line break.
 */
function renderInline(target: Node, text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index > 0) target.appendChild(document.createElement('br'));
    let cursor = 0;
    for (const token of line.matchAll(INLINE)) {
      if (token.index > cursor) {
        target.appendChild(document.createTextNode(line.slice(cursor, token.index)));
      }
      target.appendChild(inlineNode(token));
      cursor = token.index + token[0].length;
    }
    if (cursor < line.length) target.appendChild(document.createTextNode(line.slice(cursor)));
  });
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
 * Renders one table row, each cell through the inline grammar.
 */
function renderRow(cells: string[], tag: 'th' | 'td'): HTMLElement {
  const row = document.createElement('tr');
  for (const cell of cells) {
    const element = document.createElement(tag);
    renderInline(element, cell);
    row.appendChild(element);
  }
  return row;
}

/**
 * Renders a pipe table.
 * A header whose every cell is empty renders no `thead`, so a `|||` row hides the header.
 */
function renderTable(target: HTMLElement, lines: string[]): void {
  const table = document.createElement('table');
  const [header = [], , ...rows] = lines.map(rowCells);
  if (header.some((cell) => cell !== '')) {
    const head = document.createElement('thead');
    head.appendChild(renderRow(header, 'th'));
    table.appendChild(head);
  }
  if (!isEmpty(rows)) {
    const body = document.createElement('tbody');
    for (const row of rows) body.appendChild(renderRow(row, 'td'));
    table.appendChild(body);
  }
  target.appendChild(table);
}

/**
 * Renders the blocks of `text`, split on blank lines, as blockquotes, tables, and paragraphs.
 */
function renderBlocks(target: HTMLElement, text: string): void {
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    if (lines.every((line) => line.startsWith('>'))) {
      const quote = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      renderInline(paragraph, lines.map((line) => line.replace(/^> ?/, '')).join('\n'));
      quote.appendChild(paragraph);
      target.appendChild(quote);
    } else if (isTable(lines)) {
      renderTable(target, lines);
    } else {
      const paragraph = document.createElement('p');
      renderInline(paragraph, trimmed);
      target.appendChild(paragraph);
    }
  }
}

/**
 * Renders markdown-lite `text` into `target` as constructed DOM nodes.
 * The grammar covers paragraphs, ```` ``` ```` code fences, `>` blockquotes, and `|` pipe tables.
 * Inline, it covers `**bold**`, backticked code, `[label](https://url)` links in a new tab, and breaks.
 * A pipe table needs a `|-|-|` separator as its second line.
 * A `|||` header row renders no `thead`.
 * Passing `false` as `markdown` renders the text as-is.
 *
 * Content never reaches `innerHTML`, so server-provided strings stay inert.
 * Style the target with `ohne-prose` for the typographic flow.
 */
export function renderProse(target: HTMLElement, text: string, markdown = true): void {
  target.textContent = '';
  if (!markdown) {
    target.textContent = text;
    return;
  }
  let cursor = 0;
  for (const fence of text.matchAll(FENCE)) {
    renderBlocks(target, text.slice(cursor, fence.index));
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = fence[1] ?? '';
    pre.appendChild(code);
    target.appendChild(pre);
    cursor = fence.index + fence[0].length;
  }
  renderBlocks(target, text.slice(cursor));
}
