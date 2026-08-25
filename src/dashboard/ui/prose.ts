import type { Child } from '../render/insert.ts';

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
 * A typographic flow container, ported from PUIProse.
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
    } else {
      const paragraph = document.createElement('p');
      renderInline(paragraph, trimmed);
      target.appendChild(paragraph);
    }
  }
}

/**
 * Renders markdown-lite `text` into `target` as constructed DOM nodes.
 * The grammar covers paragraphs, ```` ``` ```` code fences, `>` blockquotes, and `**bold**`.
 * It also covers backticked code, `[label](https://url)` links opening in a new tab, and line breaks.
 * `markdown: false` renders the text as-is.
 *
 * The zero-dependency stand-in for the source's marked + DOMPurify pipeline.
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
