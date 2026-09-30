import type { Child } from '../render/insert.ts';
import type { ProseAlign, ProseBlock, ProseInline, ProseItem, ProseRow } from './_prose-model.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { h } from '../render/h.ts';
import { parseProse } from './_prose-model.ts';
import { icon } from './icon.ts';
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
 * Options for `renderProse`.
 */
export interface RenderProseOptions {
  /**
   * Controls if the text renders as markdown-lite.
   * `false` renders it as-is.
   *
   * @default
   * true
   */
  markdown?: boolean;

  /**
   * Controls which `[label](url)` links render as links.
   * `true`: http(s) links open in a new tab, and local paths link in place.
   * `'local'`: only local paths link; other links render as their label.
   * `false`: every link renders as its label.
   *
   * @default
   * true
   */
  links?: boolean | 'local';
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

/**
 * Builds the node for one inline run.
 */
function inlineNode(run: ProseInline): Node {
  switch (run.kind) {
    case 'text':
      return document.createTextNode(run.text);
    case 'break':
      return document.createElement('br');
    case 'code': {
      const code = document.createElement('code');
      code.textContent = run.text;
      return code;
    }
    case 'link': {
      const anchor = inlineElement('a', run.content);
      anchor.setAttribute('href', run.href);
      if (!run.local) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      }
      return anchor;
    }
    default:
      return inlineElement(run.kind, run.content);
  }
}

/**
 * Builds an element holding inline runs.
 */
function inlineElement(tag: string, content: ProseInline[]): HTMLElement {
  const element = document.createElement(tag);
  for (const run of content) element.appendChild(inlineNode(run));
  return element;
}

/**
 * Builds one table row, a `tag` cell per entry, each aligned as its column.
 */
function rowElement(row: ProseRow, tag: 'th' | 'td', align: ProseAlign[]): HTMLElement {
  const element = document.createElement('tr');
  row.forEach((cell, index) => {
    const node = inlineElement(tag, cell);
    const side = align[index] ?? 'start';
    if (side !== 'start') node.style.textAlign = side;
    element.appendChild(node);
  });
  return element;
}

/**
 * Builds one list item: a task's box, its text, then its nested blocks.
 * A task's box is an icon, not an input, since checking it would change nothing.
 */
function itemElement(item: ProseItem): HTMLElement {
  const element = inlineElement('li', item.content);
  if (!isNull(item.checked)) {
    element.classList.add('ohne-prose-task');
    element.prepend(icon(item.checked ? 'square-check' : 'square'));
  }
  for (const child of item.children) element.appendChild(blockElement(child));
  return element;
}

/**
 * Builds the element for one block.
 */
function blockElement(block: ProseBlock): HTMLElement {
  switch (block.kind) {
    case 'paragraph':
      return inlineElement('p', block.content);
    case 'heading':
      return inlineElement(`h${block.level}`, block.content);
    case 'rule':
      return document.createElement('hr');
    case 'quote': {
      const quote = document.createElement('blockquote');
      for (const child of block.blocks) quote.appendChild(blockElement(child));
      return quote;
    }
    case 'list': {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
      for (const item of block.items) list.appendChild(itemElement(item));
      return list;
    }
    case 'code': {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.appendChild(code);
      return pre;
    }
    case 'table': {
      const table = document.createElement('table');
      if (block.head) {
        const head = document.createElement('thead');
        head.appendChild(rowElement(block.head, 'th', block.align));
        table.appendChild(head);
      }
      if (block.rows.length > 0) {
        const body = document.createElement('tbody');
        for (const row of block.rows) body.appendChild(rowElement(row, 'td', block.align));
        table.appendChild(body);
      }
      const scroller = document.createElement('div');
      scroller.className = 'ohne-prose-table';
      scroller.appendChild(table);
      return scroller;
    }
  }
}

/**
 * Renders markdown-lite `text` into `target` as constructed DOM nodes.
 * Blocks are paragraphs, `#` headings, `-` and `1.` lists with nesting and `[x]` tasks, and `---` rules.
 * Blocks also include ```` ``` ```` code fences, `>` blockquotes, and `|` pipe tables.
 * Inline, it reads `**bold**`, `*italic*`, `~~struck~~`, backticked code, `[label](url)` links, and breaks.
 * A `\` escapes a punctuation mark, and an image renders as its alt text.
 * A pipe table needs a `|-|-|` separator as its second line, whose colons align its columns.
 * A `|||` header row renders no `thead`.
 *
 * Content never reaches `innerHTML`, so server-provided strings stay inert.
 * Style the target with `ohne-prose` for the typographic flow.
 *
 * @example
 * ```ts
 * renderProse(target, 'See [the docs](https://example.com).', { links: false })
 * ```
 */
export function renderProse(
  target: HTMLElement,
  text: string,
  options: RenderProseOptions = {},
): void {
  const { markdown = true, links = true } = options;
  target.textContent = '';
  if (!markdown) {
    target.textContent = text;
    return;
  }
  for (const block of parseProse(text, links)) target.appendChild(blockElement(block));
}
