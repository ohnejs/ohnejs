import type { Child } from '../render/insert.ts';
import type { ProseBlock, ProseInline, ProseRow } from './_prose-model.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { h } from '../render/h.ts';
import { parseProse } from './_prose-model.ts';
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
   * Controls if `[label](https://url)` renders as a link in a new tab.
   * `false` renders the label as plain text.
   *
   * @default
   * true
   */
  links?: boolean;
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
    case 'link': {
      const anchor = document.createElement('a');
      anchor.textContent = run.text;
      anchor.setAttribute('href', run.href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      return anchor;
    }
    default: {
      const element = document.createElement(run.kind);
      element.textContent = run.text;
      return element;
    }
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
 * Builds one table row, a `tag` cell per entry.
 */
function rowElement(row: ProseRow, tag: 'th' | 'td'): HTMLElement {
  const element = document.createElement('tr');
  for (const cell of row) element.appendChild(inlineElement(tag, cell));
  return element;
}

/**
 * Builds the element for one block.
 */
function blockElement(block: ProseBlock): HTMLElement {
  switch (block.kind) {
    case 'paragraph':
      return inlineElement('p', block.content);
    case 'quote': {
      const quote = document.createElement('blockquote');
      quote.appendChild(inlineElement('p', block.content));
      return quote;
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
        head.appendChild(rowElement(block.head, 'th'));
        table.appendChild(head);
      }
      if (!isEmpty(block.rows)) {
        const body = document.createElement('tbody');
        for (const row of block.rows) body.appendChild(rowElement(row, 'td'));
        table.appendChild(body);
      }
      return table;
    }
  }
}

/**
 * Renders markdown-lite `text` into `target` as constructed DOM nodes.
 * The grammar covers paragraphs, ```` ``` ```` code fences, `>` blockquotes, and `|` pipe tables.
 * Inline, it covers `**bold**`, backticked code, `[label](https://url)` links in a new tab, and breaks.
 * A pipe table needs a `|-|-|` separator as its second line.
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
